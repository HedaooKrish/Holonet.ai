// apps/api/src/services/llm.service.ts

import Groq from 'groq-sdk'
import { logger } from '../lib/logger'

const client = new Groq({ apiKey: process.env.GROQ_API_KEY! })

export interface ArticleAnalysis {
    summary: string
    tags: string[]
    technicalDepth: number
}

const VALID_TAGS = [
    'llm', 'model-release', 'research-paper', 'open-source',
    'computer-vision', 'policy', 'startup-funding', 'tooling',
    'robotics', 'multimodal'
]

export async function analyzeArticle(
    title: string,
    content: string
): Promise<ArticleAnalysis | null> {
    try {
        const truncated = content.slice(0, 2000)

        const response = await client.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: 'You are an AI news analyst. Return only valid JSON with no special characters or escape sequences in string values.'
                },
                {
                    role: 'user',
                    content: `Analyze this article:

Title: ${title}
Content: ${truncated}

Return this JSON structure:
{
  "summary": "2-3 sentence plain English summary with no special characters",
  "tags": ["1-3 tags from: llm, model-release, research-paper, open-source, computer-vision, policy, startup-funding, tooling, robotics, multimodal"],
  "technicalDepth": 1
}

technicalDepth must be integer 1-5.`
                }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' } // forces valid JSON — no escape issues
        })

        const text = response.choices[0]?.message?.content?.trim()
        if (!text) throw new Error('Empty response from Groq')

        const parsed = JSON.parse(text) as ArticleAnalysis

        return {
            summary: typeof parsed.summary === 'string'
                ? parsed.summary.slice(0, 500)
                : 'Summary unavailable.',
            tags: Array.isArray(parsed.tags)
                ? parsed.tags.filter(t => VALID_TAGS.includes(t))
                : [],
            technicalDepth: typeof parsed.technicalDepth === 'number'
                ? Math.min(5, Math.max(1, Math.round(parsed.technicalDepth)))
                : 2
        }

    } catch (err) {
        logger.error({ err, title }, 'LLM analysis failed')
        return null
    }
}