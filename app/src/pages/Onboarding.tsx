import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BackLink, Page } from '@/components/Page'
import { api } from '@/lib/api'
import { addDays, shortLabel, today as getToday, WEEKDAYS } from '@/lib/date'
import { saveDraft } from '@/lib/draft'
import { cn } from '@/lib/utils'
import type { DailyMinutes, FollowupQuestion, PlanInput } from '@/types'

type Step = 'goal' | 'deadline' | 'minutes' | 'weekdays' | 'slot' | 'busy' | 'followup'
const STEPS: Step[] = ['goal', 'deadline', 'minutes', 'weekdays', 'slot', 'busy', 'followup']

const GOAL_EXAMPLES = ['経済学の期末試験', 'TOEIC 600点', '簿記3級']
const SLOTS = ['朝', '昼', '夕方', '夜', '決まっていない']
const BUSY_EXAMPLES = ['バイト', 'サークル', 'ゼミ', '部活']

export default function Onboarding() {
  const navigate = useNavigate()
  const today = getToday()
  const [step, setStep] = useState<Step>('goal')
  const [input, setInput] = useState<PlanInput>({
    goal: '',
    deadline: '',
    daily_minutes: 30,
    available_weekdays: [0, 1, 2, 3, 4, 5, 6],
    time_slot: '',
    busy_note: '',
    notes: '',
  })
  const [questions, setQuestions] = useState<FollowupQuestion[] | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const index = STEPS.indexOf(step)
  const update = (patch: Partial<PlanInput>) => setInput((prev) => ({ ...prev, ...patch }))

  // 最後の画面に来たら、AIに追加の質問を1〜2問だけ考えてもらう
  useEffect(() => {
    if (step !== 'followup' || questions) return
    setLoading('質問を考えています')
    api
      .followupQuestions(input)
      .then((res) => {
        setQuestions(res.questions.slice(0, 2))
        setAnswers(res.questions.slice(0, 2).map(() => ''))
      })
      .catch(() => {
        const fallback = [{ question: '使う教材や、勉強する範囲を教えてください' }]
        setQuestions(fallback)
        setAnswers([''])
      })
      .finally(() => setLoading(null))
  }, [step, questions, input])

  const canNext: Record<Step, boolean> = {
    goal: input.goal.trim() !== '',
    deadline: input.deadline > today,
    minutes: true,
    weekdays: input.available_weekdays.length > 0,
    slot: input.time_slot !== '',
    busy: true,
    followup: questions !== null && loading === null,
  }

  async function next() {
    if (step !== 'followup') {
      setStep(STEPS[index + 1])
      return
    }
    const notes = (questions ?? [])
      .map((q, i) => `${q.question}：${answers[i]?.trim() || '特になし'}`)
      .join('\n')
    const full = { ...input, notes }
    setLoading('AIが計画の案を作っています')
    setError(null)
    try {
      const res = await api.generatePlan(full, today)
      saveDraft({ input: full, tasks: res.tasks })
      navigate('/plan')
    } catch (e) {
      setError(e instanceof Error ? `計画を作れませんでした：${e.message}` : '計画を作れませんでした')
    } finally {
      setLoading(null)
    }
  }

  function back() {
    if (index === 0) navigate('/')
    else setStep(STEPS[index - 1])
  }

  const bottom = (
    <div className="grid grid-cols-[1fr_2fr] gap-3">
      <Button variant="quiet" onClick={back} disabled={loading !== null}>
        戻る
      </Button>
      <Button onClick={next} disabled={!canNext[step] || loading !== null}>
        {step === 'followup' ? '計画の案を作る' : '次へ'}
      </Button>
    </div>
  )

  return (
    <Page bottom={bottom}>
      <BackLink />
      <div className="mt-2 flex items-center gap-3" aria-label={`質問 ${index + 1} / ${STEPS.length}`}>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-card">
          <div
            className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <span className="text-note text-sub">
          {index + 1} / {STEPS.length}
        </span>
      </div>

      <div className="mt-8">
        {step === 'goal' && (
          <Question title="何の勉強を続けたいですか？" htmlFor="goal">
            <Input
              id="goal"
              value={input.goal}
              onChange={(e) => update({ goal: e.target.value })}
              placeholder="例：経済学の期末試験"
            />
            <Chips items={GOAL_EXAMPLES} onPick={(v) => update({ goal: v })} />
          </Question>
        )}

        {step === 'deadline' && (
          <Question title="いつまでに終わらせたいですか？" htmlFor="deadline">
            <Input
              id="deadline"
              type="date"
              min={addDays(today, 1)}
              value={input.deadline}
              onChange={(e) => update({ deadline: e.target.value })}
            />
            <Chips
              items={['2週間後', '1か月後', '3か月後']}
              onPick={(v) => update({ deadline: addDays(today, v === '2週間後' ? 14 : v === '1か月後' ? 30 : 90) })}
            />
            {input.deadline > today && (
              <p className="mt-3 text-body text-sub">{shortLabel(input.deadline)}まで</p>
            )}
          </Question>
        )}

        {step === 'minutes' && (
          <Question title="1日に何分使えますか？">
            <div className="grid grid-cols-3 gap-3">
              {([15, 30, 60] as DailyMinutes[]).map((m) => (
                <Choice key={m} selected={input.daily_minutes === m} onClick={() => update({ daily_minutes: m })}>
                  {m}分
                </Choice>
              ))}
            </div>
          </Question>
        )}

        {step === 'weekdays' && (
          <Question title="勉強できる曜日はどれですか？">
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((w, i) => {
                const on = input.available_weekdays.includes(i)
                return (
                  <Choice
                    key={w}
                    selected={on}
                    onClick={() =>
                      update({
                        available_weekdays: on
                          ? input.available_weekdays.filter((d) => d !== i)
                          : [...input.available_weekdays, i].sort(),
                      })
                    }
                    className="px-0"
                  >
                    {w}
                  </Choice>
                )
              })}
            </div>
            <p className="mt-3 text-note text-sub">押すと選ぶ・外すが切り替わります</p>
          </Question>
        )}

        {step === 'slot' && (
          <Question title="勉強するのはいつごろですか？">
            <div className="grid grid-cols-2 gap-3">
              {SLOTS.map((s) => (
                <Choice key={s} selected={input.time_slot === s} onClick={() => update({ time_slot: s })}>
                  {s}
                </Choice>
              ))}
            </div>
          </Question>
        )}

        {step === 'busy' && (
          <Question title="決まっている忙しい予定はありますか？" htmlFor="busy">
            <Input
              id="busy"
              value={input.busy_note}
              onChange={(e) => update({ busy_note: e.target.value })}
              placeholder="例：火・木の夜はバイト"
            />
            <Chips
              items={BUSY_EXAMPLES}
              onPick={(v) => update({ busy_note: input.busy_note ? `${input.busy_note}、${v}` : v })}
            />
            <p className="mt-3 text-note text-sub">なければ空のまま次へ進んでください</p>
          </Question>
        )}

        {step === 'followup' && (
          <div>
            <h1 className="text-title font-bold">あと少しだけ教えてください</h1>
            {loading === '質問を考えています' && <p className="mt-4 text-body text-sub" role="status">{loading}</p>}
            {questions?.map((q, i) => (
              <div key={i} className="mt-6">
                <label htmlFor={`q${i}`} className="text-body font-bold">
                  {q.question}
                </label>
                <Input
                  id={`q${i}`}
                  className="mt-2"
                  value={answers[i] ?? ''}
                  onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))}
                />
                {q.options && q.options.length > 0 && (
                  <Chips
                    items={q.options}
                    onPick={(v) => setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)))}
                  />
                )}
              </div>
            ))}
            {loading === 'AIが計画の案を作っています' && (
              <p className="mt-6 text-body text-sub" role="status">{loading}。30秒ほどかかります</p>
            )}
            {error && <p className="mt-6 text-body text-late" role="alert">{error}</p>}
          </div>
        )}
      </div>
    </Page>
  )
}

function Question({ title, htmlFor, children }: { title: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-title font-bold">
          {title}
        </label>
      ) : (
        <h1 className="text-title font-bold">{title}</h1>
      )}
      <div className="mt-6">{children}</div>
    </div>
  )
}

function Choice({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'min-h-tap rounded-2xl border-2 px-3 text-body font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60',
        selected ? 'border-accent bg-accent text-base' : 'border-line bg-card text-fg hover:border-sub',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Chips({ items, onPick }: { items: string[]; onPick: (v: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onPick(item)}
          className="min-h-tap rounded-full border-2 border-line px-4 text-note text-fg hover:border-sub focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60"
        >
          {item}
        </button>
      ))}
    </div>
  )
}
