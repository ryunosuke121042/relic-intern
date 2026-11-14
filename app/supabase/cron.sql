-- 毎晩21時（日本時間）に崩れを確認し、毎朝7時に組み直し後の予定を通知する。
-- <PROJECT_REF> と <CRON_SECRET> を自分の値に置き換えてから SQL Editor で実行してください。
-- pg_cron の時刻はUTCなので、21時JST = 12時UTC、7時JST = 22時UTC（前日）です。

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nightly-check',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/nightly-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

select cron.schedule(
  'morning-push',
  '0 22 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/morning-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- 登録を確認：select * from cron.job;
-- 止めるとき：select cron.unschedule('nightly-check'); select cron.unschedule('morning-push');
