# 目標達成アプリ（プロトタイプ）

> ブラウザだけで動くデモ版は [`browser/`](browser/) にあります。

勉強計画が崩れたとき、遅れた分の組み直しをAIが代わりにやり、スマホの画面に新しい予定を届けるアプリです。

検証したいこと：組み込み作業がなくなれば、モチベーションが下がっていても翌日また30分に戻れるか。
判定ルール：2日以上予定どおりにできなかったとき、組み直しを確定してから7日以内に、予定のある日で3回連続できたら「戻れた」。結果は `/log` で見られます。

## Supabaseなしで動かす（お試し版）

`src/config.ts` に Supabase の設定がないときは、自動で「お試し版」として動きます。Vercel などにそのまま公開するだけで使えます。

- 記録はその端末のブラウザ（localStorage）にだけ保存されます。別の端末とは共有されず、ブラウザのデータを消すと消えます
- AIは使いません。計画の案・日ごとの直し・組み直しは、ルールで作ります（`src/lib/backend/localApi.ts`）
- 「計画全体への頼みごと」は「土曜は休み」のような曜日の指定だけ使えます
- 通知は使えません（アプリを開いたときに組み直し案を出します）

Supabase の設定を書くと、AIと通知が使える完全版に切り替わります（お試し版のデータは引き継がれません）。

## ページ構成

| パス | 画面 | やること |
| --- | --- | --- |
| `/` | 今日 | 今日の予定、「できた！」「今日はムリ」、直近7日の記録。崩れていれば組み直し案のカードを出す |
| `/onboarding` | 聞き取り | 目標・期限・1日の時間・曜日・時間帯・忙しい予定を1画面1問で聞き、AIが追加で1〜2問聞く |
| `/plan` | 一緒に計画を作る | AIの計画案を表示。日をタップして「この日はムリ」「量を減らす」「別の内容にする」、自由入力で頼みごと |
| `/replan` | 組み直し案 | 遅れた分と、組み直し後の7日を表示。「この予定でいく」で確定（通知をタップするとここが開く） |
| `/log` | 検証記録 | 崩れた日、組み直しを確定した日、戻れたかどうか |

## ファイル構成

```
src/
  main.tsx, App.tsx          起動、匿名ログイン、初回のサンプル投入、画面遷移
  types.ts                   データの型
  sw.ts                      Service Worker（通知の表示とタップ時の画面遷移）
  index.css
  components/
    ui/                      shadcn/ui（Button, Card, Input, Dialog, Toast）
    Page.tsx                 画面の枠（下部固定ボタン）、戻るリンク、読み込み中、エラー
    WeekStrip.tsx            直近7日の記録
    PlanEditor.tsx           日付ごとの予定リストと部分修正（/plan と /replan で共通）
    NotificationSetup.tsx    ホーム画面への追加と通知許可の案内
  pages/                     Today, Onboarding, PlanPage, Replan, Log
  config.ts                  公開してよい設定（Supabaseの接続先など）。空ならお試し版で動く
  lib/
    repository.ts            保存と読み込みの入口（Supabaseか端末内かを切り替える）
    api.ts                   計画づくり・組み直しの入口（AIかルールかを切り替える）
    backend/                 supabaseRepository / supabaseApi（完全版）、localRepository / localApi（お試し版）
    logic.ts                 崩れの判定・組み直しの範囲・ルールでの組み直し・予定のチェック
    verification.ts          「戻れた」の判定
    push.ts                  通知の許可と登録
    sample.ts                サンプル計画
    draft.ts                 確定前の計画案（sessionStorage）
    date.ts, supabase.ts, planInput.ts, utils.ts
supabase/
  migrations/0001_init.sql   テーブル、行レベルセキュリティ、組み直し確定の関数
  cron.sql                   毎晩21時・毎朝7時の定期実行
  functions/
    _shared/                 共通処理（logic.ts は src/lib/logic.ts と同じ内容）
    followup-questions/      聞き取りの追加質問
    generate-plan/           計画案を作る
    adjust-plan/             計画の一部を作り直す
    replan/                  アプリを開いたときに崩れていれば組み直す
    nightly-check/           毎晩21時：崩れを確認し、組み直し案を作って遅れを通知
    morning-push/            毎朝7時：記録が再開するまで、組み直し後の今日の予定を通知
```

`src/lib/logic.ts` と `supabase/functions/_shared/logic.ts` は同じ内容です。片方を直したら、もう片方にもコピーしてください。

## セットアップ

必要なもの：Node.js 20以上、[Supabase](https://supabase.com) のアカウント、[Supabase CLI](https://supabase.com/docs/guides/cli)、Anthropic（Claude API）のAPIキー。

### 1. Supabaseのプロジェクトを作る

1. Supabaseで新しいプロジェクトを作る
2. Authentication > Sign In / Providers で **Anonymous sign-ins** をオンにする（ログイン画面なしで端末ごとにユーザーを作るため）
3. SQL Editor に `supabase/migrations/0001_init.sql` を貼り付けて実行する

### 2. 通知用のVAPIDキーを作る

```bash
npx web-push generate-vapid-keys
```

表示された Public Key と Private Key を控えておきます。

### 3. Edge Functions をデプロイする

```bash
supabase login
supabase link --project-ref <PROJECT_REF>

supabase secrets set \
  ANTHROPIC_API_KEY=<AnthropicのAPIキー> \
  VAPID_PUBLIC_KEY=<VAPIDの公開鍵> \
  VAPID_PRIVATE_KEY=<VAPIDの秘密鍵> \
  VAPID_SUBJECT=mailto:<自分のメールアドレス> \
  CRON_SECRET=<自分で決めた長いランダムな文字列>

# 任意：使うモデルを変える場合（既定は claude-sonnet-5-5）
# supabase secrets set AI_MODEL=<モデル名>

supabase functions deploy followup-questions
supabase functions deploy generate-plan
supabase functions deploy adjust-plan
supabase functions deploy replan
supabase functions deploy nightly-check --no-verify-jwt
supabase functions deploy morning-push --no-verify-jwt
```

`nightly-check` と `morning-push` は定期実行から呼ぶので `--no-verify-jwt` をつけます。代わりに `CRON_SECRET` で守っています。
`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` はSupabaseが自動で渡すので設定不要です。

### 4. 定期実行（pg_cron）を設定する

`supabase/cron.sql` の `<PROJECT_REF>` と `<CRON_SECRET>` を置き換えて、SQL Editor で実行します。

- 毎晩21時（日本時間）：`nightly-check`
- 毎朝7時（日本時間）：`morning-push`

### 5. アプリを動かす

`src/config.ts` の `PUBLIC_CONFIG` に、次の3つを書きます（どれも公開してよい値なので、コードに書いて問題ありません。こうすると Vercel などで環境変数を設定しなくても動きます）。

```ts
export const PUBLIC_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJ...',      // anon public キー（service_role は絶対に書かない）
  vapidPublicKey: 'B...',         // 手順2の公開鍵
}
```

```bash
npm install
npm run dev
```

`.env`（`.env.example` をコピー）や公開先の環境変数に `VITE_SUPABASE_URL` などを設定した場合は、そちらが `src/config.ts` より優先されます。

| 設定 | 場所 | 中身 |
| --- | --- | --- |
| `supabaseUrl` | `src/config.ts`（または `VITE_SUPABASE_URL`） | Project Settings > API の Project URL |
| `supabaseAnonKey` | `src/config.ts`（または `VITE_SUPABASE_ANON_KEY`） | Project Settings > API の anon public キー |
| `vapidPublicKey` | `src/config.ts`（または `VITE_VAPID_PUBLIC_KEY`） | 手順2の公開鍵 |
| `ANTHROPIC_API_KEY` | Supabase secrets | Claude APIのキー（ブラウザには出さない） |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Supabase secrets | 通知の送信用 |
| `CRON_SECRET` | Supabase secrets と cron.sql | 定期実行の合言葉 |

### 6. スマホで使う（公開）

通知はHTTPSでしか動かないので、`npm run build` の `dist` を Vercel や Netlify などで公開します（`vercel.json` と `public/_redirects` で、どのURLを開いても画面が出るようにしてあります）。`src/config.ts` に値を書いていれば、公開先で環境変数を設定する必要はありません。

iPhoneでは、Safariの共有ボタンから「ホーム画面に追加」し、ホーム画面のアイコンから開いたときだけ通知が届きます（iOS 16.4以上）。

## 動きの流れ

1. 初回はサンプル計画（経済学の期末試験、毎日30分、期限3週間後、直近2日はできなかった状態）が入っています。開くとすぐ組み直し案が作られるので、流れを試せます。「サンプルを消す」で消せます
2. 「今日はムリ」または未記録が、予定のある日で2日続くと「崩れた」と判定します
   - アプリを開いたとき：その場で `replan` を呼んで組み直し案を作る
   - 開かなかったとき：毎晩21時に `nightly-check` が組み直し案を作り、遅れを通知する
3. 翌朝以降は、「できた」が記録されるまで（最長7日）、毎朝7時に組み直し後の今日の予定を通知する
4. 組み直しはAIが行います。AIの答えがルール（入れてよい日、1日の上限時間）を守っていなければ1回だけ再試行し、それでもだめなら、遅れた分から順番に空いている日へ詰めるルールで組み直します

## プロンプトから補ったところ

- `Plan` に `notes`（聞き取りの追加質問への答え）と `is_sample`（サンプルかどうか）を足しました
- 組み直しの範囲は「今日（今日の記録があれば明日）から最大14日、期限まで」です。画面には最初の7日を出し、残りは続きの日に入れています
- `repository.listTasks(from, to)` はいまの計画の予定を返します。計画を指定したいときは `listPlanTasks(planId, from, to)` を使います
- 組み直しの確定は、予定の置き換えを一度に行うため、データベースの関数 `confirm_replan` で行います
- 期限が90日より先の場合、計画案は最初の90日分を作ります

## Supabase以外に移すとき

画面は `src/lib/repository.ts`（保存と読み込み）と `src/lib/api.ts`（AI）しか呼ばないので、`src/lib/backend/` に同じ形の実装を足して切り替えれば、画面はそのまま使えます。
