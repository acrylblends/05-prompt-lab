/**
 * What a first launch shows: five prompts, the product description with three variables and three saved versions, two sample models, one model waiting
 * to be configured, and a finished comparison with two outputs of different strengths, ready to be rated. Dates are laid around the first launch.
 */
import { addDays, dayOf, estimateTokens, type LabState, type Prompt, type PromptVersion, type Run, render } from './domain.ts'

const PRODUCT_SYSTEM = 'You are a senior B2B SaaS copywriter. Write clear, specific copy. Avoid vague superlatives. Never invent product capabilities.'
const PRODUCT_USER =
  'Write a product description for {{product_name}}.\n\nAudience: {{audience}}\nPrimary benefit: {{benefit}}\nTone: concise, confident, practical.\n\nReturn a headline, a 2-sentence summary and 3 bullet benefits.'
const PRODUCT_INPUTS = { product_name: 'FlowDesk', audience: 'Operations teams', benefit: 'Automate repetitive handoffs' }

const OUTPUT_A =
  'Make every handoff flow.\n\nFlowDesk helps operations teams automate repetitive work between people and systems, so processes keep moving without constant follow-up.\n\n- Connect routine tasks across your tools.\n- Reduce manual updates and missed steps.\n- See every handoff and its current owner.'
const OUTPUT_B =
  'Less chasing. More momentum.\n\nFlowDesk turns recurring operational handoffs into visible, reliable workflows. Your team spends less time coordinating work and more time completing it.\n\n- Automate repeatable cross-team processes.\n- Keep ownership and status visible.\n- Catch stalled work before it gets lost.'

export function seed(now: Date): LabState {
  const day = (offset: number): string => addDays(dayOf(now), offset)
  const at = (offset: number, time: string): string => `${day(offset)}T${time}`

  const prompt = (id: string, name: string, description: string, systemText: string, userTemplate: string, tags: string[], inputs: Record<string, string>, updatedAt: string, version = 1): Prompt => ({
    id,
    name,
    description,
    systemText,
    userTemplate,
    tags,
    inputs,
    version,
    updatedAt,
  })

  const prompts = [
    prompt('prompt-product', 'Product description', 'Generate concise, benefit-led product copy for a technical audience.', PRODUCT_SYSTEM, PRODUCT_USER, ['Marketing'], PRODUCT_INPUTS, at(0, '08:10'), 3),
    prompt(
      'prompt-support',
      'Support response',
      'Answer a customer question with care and a clear next step.',
      'You are a calm support agent. Answer the question asked, then give one clear next step. Do not promise what you cannot confirm.',
      'A customer on the {{plan}} plan wrote:\n\n{{message}}\n\nWrite a short reply.',
      ['Customer service'],
      { plan: 'Team', message: 'My export has been stuck for an hour.' },
      at(-1, '16:20'),
    ),
    prompt(
      'prompt-sql',
      'SQL explainer',
      'Explain a query in plain words for someone new to the schema.',
      'You explain SQL to developers who are new to a codebase. Be exact, and name each table.',
      'Explain what this query does, step by step:\n\n{{query}}',
      ['Developer'],
      { query: 'select plan, count(*) from accounts group by plan' },
      at(-6, '11:00'),
    ),
    prompt(
      'prompt-meeting',
      'Meeting summary',
      'Turn rough notes into decisions and owners.',
      'You turn meeting notes into a short record. Never add a decision that is not in the notes.',
      'Summarise these notes as decisions, then actions with owners:\n\n{{notes}}',
      ['Productivity'],
      { notes: 'Launch moved to Tuesday. Mia checks the copy. Tom asks legal.' },
      at(-7, '15:45'),
    ),
    prompt(
      'prompt-release',
      'Release notes',
      'Write release notes people want to read.',
      'You write release notes for users, not for developers. Lead with what changed for them.',
      'Write release notes for {{version}} from these changes:\n\n{{changes}}',
      ['Developer'],
      { version: '2.4', changes: 'Faster search. Fixed CSV export. New dark mode.' },
      at(-9, '10:30'),
    ),
  ]

  const version = (promptId: string, revision: number, systemText: string, userTemplate: string, note: string, createdAt: string): PromptVersion => ({
    id: `version-${promptId.slice(7)}-${revision}`,
    promptId,
    revision,
    systemText,
    userTemplate,
    note,
    createdAt,
  })

  const versions = [
    version('prompt-product', 1, 'You are a copywriter.', 'Write a product description for {{product_name}}.', 'First draft', at(-12, '10:05')),
    version('prompt-product', 2, PRODUCT_SYSTEM, 'Write a product description for {{product_name}}.\n\nAudience: {{audience}}\nPrimary benefit: {{benefit}}', 'Added audience and benefit', at(-5, '14:20')),
    version('prompt-product', 3, PRODUCT_SYSTEM, PRODUCT_USER, 'Fixed the output shape', at(0, '08:10')),
    ...prompts.slice(1).map((item) => version(item.id, 1, item.systemText, item.userTemplate, 'First version', item.updatedAt)),
  ]

  const run = (id: string, slot: 'A' | 'B', modelId: string, modelName: string, output: string, durationMs: number): Run => ({
    id,
    comparisonId: 'comparison-seed',
    slot,
    promptId: 'prompt-product',
    promptVersionId: 'version-product-3',
    modelId,
    modelName,
    temperature: 0.6,
    inputs: PRODUCT_INPUTS,
    systemText: PRODUCT_SYSTEM,
    userTemplate: PRODUCT_USER,
    userText: render(PRODUCT_USER, PRODUCT_INPUTS),
    output,
    tokens: estimateTokens(`${PRODUCT_SYSTEM}${render(PRODUCT_USER, PRODUCT_INPUTS)}${output}`),
    durationMs,
    cost: 0,
    status: 'done',
    createdAt: at(0, '08:12'),
  })

  return {
    version: 1,
    prompts,
    versions,
    models: [
      { id: 'sample-crisp', name: 'Sample Crisp', provider: 'sample', model: 'sample-crisp', contextTokens: 8000, costPer1k: 0 },
      { id: 'sample-detailed', name: 'Sample Detailed', provider: 'sample', model: 'sample-detailed', contextTokens: 8000, costPer1k: 0 },
      { id: 'model-local', name: 'My model', provider: 'openai-compatible', model: 'my-model', contextTokens: 32000, costPer1k: 0 },
    ],
    runs: [run('run-seed-a', 'A', 'sample-crisp', 'Sample Crisp', OUTPUT_A, 1200), run('run-seed-b', 'B', 'sample-detailed', 'Sample Detailed', OUTPUT_B, 2400)],
    evaluations: [
      { id: 'evaluation-1', runId: 'run-seed-a', criterion: 'Clarity', rating: 4, note: 'Easy to scan.', createdAt: at(0, '08:15') },
      { id: 'evaluation-2', runId: 'run-seed-b', criterion: 'Clarity', rating: 5, note: 'The headline lands.', createdAt: at(0, '08:15') },
    ],
  }
}
