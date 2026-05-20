// apps/api/src/services/digest.service.ts

import { Resend } from 'resend'
import { render } from '@react-email/components'
import { db } from '../lib/db'
import { logger } from '../lib/logger'
import { DigestEmail } from '../emails/DigestEmail'

const resend = new Resend(process.env.RESEND_API_KEY!)

// Format date as "Monday, May 13"
function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    })
}

// Build and send digest for a single user
async function sendDigestToUser(userId: string, email: string) {
    // Fetch user preferences
    const prefs = await db.userPreferences.findUnique({
        where: { userId }
    })

    // No preferences means they never completed onboarding — skip
    if (!prefs || prefs.topics.length === 0) {
        logger.info({ userId }, 'Skipping user — no preferences set')
        return
    }

    // Fetch articles from last 24 hours that match their preferences
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000)

    const articles = await db.article.findMany({
        where: {
            processedAt: { not: null },
            publishedAt: { gte: since },
            tags: { hasSome: prefs.topics },
            technicalDepth: { gte: prefs.minTechnicalDepth }
        },
        orderBy: { publishedAt: 'desc' },
        take: 10, // top 10 articles for the digest
        select: {
            id: true,
            title: true,
            url: true,
            source: true,
            summary: true,
            tags: true,
            technicalDepth: true,
        }
    })

    // Not enough articles — widen the search to last 48 hours
    if (articles.length < 3) {
        logger.info({ userId }, 'Not enough articles in 24h — skipping digest')
        return
    }

    // Render the email HTML using React Email
    const html = await render(
        DigestEmail({
            userEmail: email,
            articles,
            digestDate: formatDate(new Date())
        })
    )

    // Send via Resend
    const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
        to: email,
        subject: `Your AI digest — ${formatDate(new Date())}`,
        html
    })

    if (error) {
        logger.error({ error, userId }, 'Failed to send digest email')
        return
    }

    // Save digest record to DB so user can view it in the archive
    const digest = await db.digest.create({
        data: {
            userId,
            sentAt: new Date()
        }
    })

    // Link articles to this digest
    await db.digestArticle.createMany({
        data: articles.map((article, index) => ({
            digestId: digest.id,
            articleId: article.id,
            rank: index + 1
        }))
    })

    logger.info({ userId, articleCount: articles.length }, 'Digest sent successfully')
}

// Main function — sends digests to all eligible users
export async function sendDailyDigests() {
    logger.info('Starting daily digest send...')

    // Fetch all users who want daily digests
    const users = await db.user.findMany({
        where: {
            preferences: {
                digestFrequency: 'daily'
            }
        },
        select: {
            id: true,
            email: true,
        }
    })

    logger.info(`Sending digests to ${users.length} users`)

    // Send to each user sequentially to avoid rate limits
    for (const user of users) {
        try {
            await sendDigestToUser(user.id, user.email)
            // Small delay between sends
            await new Promise(r => setTimeout(r, 500))
        } catch (err) {
            logger.error({ err, userId: user.id }, 'Digest failed for user')
        }
    }

    logger.info('Daily digest send complete')
}