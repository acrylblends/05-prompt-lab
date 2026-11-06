/**
 * The lab a new install starts with: five prompts, a version of each, two seeded comparison outputs for the product-description prompt and one
 * quick evaluation. The seeded outputs are real text, not placeholders, so the comparison column shows something before a key is configured.
 */
import type { LabState, Prompt, PromptVersion, Run } from './domain.ts'
import { stampOf, variablesOf } from './domain.ts'

interface PromptSeed {
  readonly name: string
  readonly description: string
  readonly systemText: string
  readonly userTemplate: string
  readonly tags: readonly string[]
  readonly ageHours: number
  readonly version: number
}

const PROMPTS: readonly PromptSeed[] = [
  {
    name: 'Product description',
    description: 'Generate concise, benefit-led product copy for a technical audience.',
    systemText:
      'You are a senior B2B SaaS copywriter. Write clear, specific copy. Avoid vague superlatives. Never invent product capabilities.',
    userTemplate:
      'Write a product description for {{product_name}}.\n\nAudience: {{audience}}\nPrimary benefit: {{benefit}}\nTone: concise, confident, practical.\n\nReturn a headline, a 2-sentence summary and 3 bullet benefits.',
    tags: ['marketing', 'copy'],
    ageHours: 2,
    version: 3,
  },
  {
    name: 'Support response',
    description: 'Answer a customer complaint with a clear next step and no blame.',
    systemText:
      'You are a calm support lead. Ack the problem in one sentence, explain what happened without blame, give the next step and a time.',
    userTemplate:
      'Customer: {{customer}}\nProblem: {{problem}}\nWhat we know: {{detail}}\nWhat happens next: {{next_step}}\n\nWrite a reply under 120 words.',
    tags: ['support', 'copy'],
    ageHours: 26,
    version: 2,
  },
  {
    name: 'SQL explainer',
    description: 'Explain a SQL query to a product manager in plain language.',
    systemText: 'You explain SQL without jargon. Name the tables, the filter and the shape of the result. Never guess a column that is not shown.',
    userTemplate: 'Explain this query to a product manager:\n\n{{query}}\n\nThen list one question they should ask before trusting the result.',
    tags: ['developer', 'sql'],
    ageHours: 24 * 7,
    version: 1,
  },
  {
    name: 'Meeting summary',
    description: 'Turn a raw meeting transcript into decisions, owners and open questions.',
    systemText: 'Summarise decisions, owners and open questions only. Do not invent an owner. Keep each line under 20 words.',
    userTemplate: 'Transcript:\n\n{{transcript}}\n\nReturn three lists: Decisions, Owners and Open questions.',
    tags: ['productivity', 'meetings'],
    ageHours: 24 * 8,
    version: 2,
  },
  {
    name: 'Release notes',
    description: 'Write release notes a customer can understand, grouped by what changed for them.',
    systemText: 'Write for the customer, not the commit log. Say what changed, why it matters and what to do next. Never mention internal names.',
    userTemplate: 'Version: {{version}}\nChanges:\n\n{{changes}}\n\nReturn a short intro and a bullet per customer-facing change.',
    tags: ['developer', 'docs'],
    ageHours: 24 * 9,
    version: 1,
  },
]

const PRODUCT_A = `Make every handoff flow.

FlowDesk helps operations teams automate repetitive work between people and systems, so processes keep moving without constant follow-up.

- Connect routine tasks across your tools.
- Reduce manual updates and missed steps.
- See every handoff and its current owner.`

const PRODUCT_B = `Less chasing. More momentum.

FlowDesk turns recurring operational handoffs into visible, reliable workflows. Your team spends less time coordinating work and more time completing it.

- Automate repeatable cross-team processes.
- Keep ownership and status visible.
- Catch stalled work before it gets lost.`

export function seed(now: Date, newId: (kind: string) => string): LabState {
  const at = (hoursAgo: number): string => stampOf(new Date(now.getTime() - hoursAgo * 3_600_000))
  const prompts: Prompt[] = PROMPTS.map((item) => ({
    id: newId('prompt'),
    name: item.name,
    description: item.description,
    systemText: item.systemText,
    userTemplate: item.userTemplate,
    variables: variablesOf(item.userTemplate),
    tags: [...item.tags],
    version: item.version,
    createdAt: at(item.ageHours + 24 * 40),
    updatedAt: at(item.ageHours),
  }))
  const versions: PromptVersion[] = prompts.flatMap((prompt) =>
    Array.from({ length: prompt.version }, (_, index) => ({
      id: newId('version'),
      promptId: prompt.id,
      revision: index + 1,
      content: `${prompt.systemText}\n\n${prompt.userTemplate}`,
      createdAt: at((prompt.version - index) * 24),
    })),
  )
  const product = prompts[0] as Prompt
  const productVersion = versions.find((version) => version.promptId === product.id && version.revision === product.version)
  if (productVersion === undefined) throw new Error('the seed has no product-description version')
  const inputs = { product_name: 'FlowDesk', audience: 'Operations teams', benefit: 'Automate repetitive handoffs' }
  const runs: Run[] = [
    {
      id: newId('run'),
      promptId: product.id,
      promptVersionId: productVersion.id,
      model: 'GPT-4.1 mini',
      inputs,
      output: PRODUCT_A,
      tokens: 312,
      durationMs: 1200,
      status: 'done',
      createdAt: at(1),
    },
    {
      id: newId('run'),
      promptId: product.id,
      promptVersionId: productVersion.id,
      model: 'Claude Sonnet',
      inputs,
      output: PRODUCT_B,
      tokens: 287,
      durationMs: 2400,
      status: 'done',
      createdAt: at(0.5),
    },
  ]
  return { version: 1, prompts, versions, runs, evaluations: [] }
}
