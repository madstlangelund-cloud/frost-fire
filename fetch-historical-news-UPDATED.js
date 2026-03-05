#!/usr/bin/env node

/**
 * Frost&Fire Historical News Fetcher - UPDATED VERSION
 * 
 * Henter ÆLDRE artikler (6-12 måneder tilbage) fra videnskabelige kilder
 * + høj-kvalitets videnskabsjournalistik
 * Bruger samme Claude AI summaries
 * One-time script til at fylde arkiv ved launch
 * 
 * Kør: node fetch-historical-news.js
 */

require('dotenv').config();
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const Parser = require("rss-parser");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Validate credentials
if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing environment variables!");
  console.error("Required: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY");
  process.exit(1);
}

const client = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const parser = new Parser();

// ===== ÆNDRING 1: TIER-BASEREDE KILDER (4 lags) =====

// TIER 1: Peer-reviewed journals (top impact factor)
const PEER_REVIEWED_TIER1 = [
  {
    name: "Nature Medicine (Peer-Reviewed)",
    feed: "https://www.nature.com/nm/current_issue/rss",
    daysBack: 365,
    type: "journal",
  },
  {
    name: "The Lancet (Peer-Reviewed)",
    feed: "https://www.thelancet.com/rss/lancet.xml",
    daysBack: 365,
    type: "journal",
  },
  {
    name: "JAMA (Peer-Reviewed)",
    feed: "https://jamanetwork.com/journals/jama/rss",
    daysBack: 365,
    type: "journal",
  },
];

// TIER 2: Specialized peer-reviewed journals
const PEER_REVIEWED_TIER2 = [
  {
    name: "Cell - Metabolism (Peer-Reviewed)",
    feed: "https://www.cell.com/metabolism/rss",
    daysBack: 365,
    type: "journal",
  },
  {
    name: "Journal of Applied Physiology (Peer-Reviewed)",
    feed: "https://journals.physiology.org/journal/jappl",
    daysBack: 365,
    type: "journal",
  },
  {
    name: "Circulation (Peer-Reviewed)",
    feed: "https://www.ahajournals.org/journal/circoutcomes",
    daysBack: 365,
    type: "journal",
  },
];

// TIER 3: High-quality science journalism & communication
const SCIENCE_JOURNALISM_TIER1 = [
  {
    name: "Science Daily - Health (Vetted Research News)",
    feed: "https://www.sciencedaily.com/rss/health_medicine/exercise_fitness.xml",
    daysBack: 365,
    type: "journalism",
    credibility: "HIGH",
  },
  {
    name: "The Conversation - Health (Expert Journalists)",
    feed: "https://theconversation.com/health/articles.atom",
    daysBack: 365,
    type: "journalism",
    credibility: "HIGH",
  },
  {
    name: "Medical News Today - Cardiovascular (Medical Reviewed)",
    feed: "https://www.medicalnewstoday.com/rss/heart-health.xml",
    daysBack: 365,
    type: "journalism",
    credibility: "MEDIUM-HIGH",
  },
];

// TIER 4: University & research institute press releases
const RESEARCH_COMMUNICATIONS = [
  {
    name: "Harvard Medical School - Research News",
    feed: "https://hms.harvard.edu/news/rss",
    daysBack: 365,
    type: "research_news",
    credibility: "HIGH",
  },
  {
    name: "Stanford Medicine - News",
    feed: "https://med.stanford.edu/news.html",
    daysBack: 365,
    type: "research_news",
    credibility: "HIGH",
  },
  {
    name: "MIT - Health & Medicine",
    feed: "https://news.mit.edu/health",
    daysBack: 365,
    type: "research_news",
    credibility: "HIGH",
  },
];

// Kombinér alle kilder
const SOURCES = [
  ...PEER_REVIEWED_TIER1,
  ...PEER_REVIEWED_TIER2,
  ...SCIENCE_JOURNALISM_TIER1,
  ...RESEARCH_COMMUNICATIONS,
];

// ===== ÆNDRING 2: 3 KEYWORD ARRAYS (i stedet for 1) =====

// PRIMARY KEYWORDS - må have mindst 1
const PRIMARY_KEYWORDS = [
  // Sauna & Heat
  "sauna",
  "heat stress",
  "thermal stress",
  "hot water",
  "hyperthermia",
  "sauna health",
  "sauna benefits",
  "sauna research",
  
  // Cold & Winter Swimming
  "cold water immersion",
  "cold exposure",
  "winter swimming",
  "cold water swimming",
  "cryotherapy",
  "cold stress",
  
  // Health Outcomes
  "cardiovascular",
  "heart health",
  "endothelial",
  "blood pressure",
  "hypertension",
  "mitochondria",
  "brown fat",
  "brown adipose",
  "thermogenesis",
  "immune system",
  "immune response",
  "inflammation",
  "stress response",
  "heat therapy",
  "cold therapy",
];

// SECONDARY KEYWORDS - må have mindst 1
const SECONDARY_KEYWORDS = [
  // Peer-reviewed indikatorer
  "study",
  "research",
  "trial",
  "clinical",
  "randomized",
  "placebo",
  "efficacy",
  "mechanism",
  "systematic review",
  "meta-analysis",
  "methodology",
  "results",
  "conclusion",
  
  // Journalism kvalitets-indikatorer
  "scientists",
  "researchers",
  "university",
  "institute",
  "professor",
  "study found",
  "research shows",
  "experts say",
  "according to",
  "published in",
];

// AVOID - Ord som indikerer lavt-kvalitet
const QUALITY_BLACKLIST = [
  "opinion",
  "wellness blog",
  "lifestyle hack",
  "unproven claims",
  "testimonial",
  "anecdote",
  "not scientifically",
  "miracle cure",
  "guaranteed",
  "secret formula",
  "alternative medicine",
  "homeopathy",
  "supplement company",
  "paid promotion",
];

/**
 * Tjek hvis artikel allerede eksisterer i databasen
 */
async function articleExists(title) {
  const { data } = await supabase
    .from("news_articles")
    .select("id")
    .ilike("title", title)
    .single()
    .catch(() => ({ data: null }));

  return !!data;
}

/**
 * Brug Claude til at skrive et kort resumé
 */
async function generateSummary(title, content) {
  try {
    const message = await client.messages.create({
      model: "claude-opus-4-5-20251101",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are a science journalist. Write a short 1-2 sentence summary in English about sauna and cold water immersion research. Be clear so anyone can understand.

Title: ${title}
Content: ${content || "No content available"}

Respond ONLY with the summary, no explanations.`,
        },
      ],
    });

    return message.content[0].type === "text" ? message.content[0].text : "";
  } catch (error) {
    console.error(`Error generating summary: ${error.message}`);
    return "";
  }
}

/**
 * Automatisk kategorisering baseret på keywords
 */
function categorizeArticle(title, content) {
  const text = (title + " " + (content || "")).toLowerCase();

  if (
    text.includes("sauna") ||
    text.includes("heat") ||
    text.includes("temperature")
  ) {
    return "sauna";
  } else if (
    text.includes("cold") ||
    text.includes("winter") ||
    text.includes("cryotherapy") ||
    text.includes("ice")
  ) {
    return "cold";
  } else {
    return "health";
  }
}

/**
 * Vælg emoji baseret på kategori
 */
function selectEmoji(category) {
  const emojis = {
    sauna: "🔥",
    cold: "❄️",
    health: "💪",
  };
  return emojis[category] || "📰";
}

/**
 * ===== ÆNDRING 3: NY QUALITY FILTER FUNKTION (4 checks) =====
 * 
 * QUALITY FILTER - Både peer-reviewed + science journalism
 * Accepterer:
 * 1. Peer-reviewed journal artikler
 * 2. Høj-kvalitets videnskabsjournalistik fra troværdige kilder
 */
function isHighQuality(title, content, source) {
  const text = (title + " " + (content || "")).toLowerCase();
  
  // 1. SORT BLACKLIST - hvis nogen af disse ord er der, skip
  if (QUALITY_BLACKLIST.some(word => text.includes(word.toLowerCase()))) {
    console.log(`      ⊘ Blacklist match - skipped`);
    return false;
  }

  // 2. MUST HAVE PRIMARY KEYWORD (sauna/cold/health)
  const hasPrimaryKeyword = PRIMARY_KEYWORDS.some(keyword => 
    text.includes(keyword.toLowerCase())
  );
  
  if (!hasPrimaryKeyword) {
    console.log(`      ⊘ No primary keyword match`);
    return false;
  }

  // 3. MUST HAVE AT LEAST ONE SECONDARY KEYWORD
  // Dette fungerer for både peer-reviewed (studie-ord) og journalism (kilde-ord)
  const hasSecondaryKeyword = SECONDARY_KEYWORDS.some(keyword => 
    text.includes(keyword.toLowerCase())
  );
  
  if (!hasSecondaryKeyword) {
    console.log(`      ⊘ Not from credible source or study format`);
    return false;
  }

  // 4. AVOID PROMOTIONAL LANGUAGE
  const promotionalWords = [
    "revolutionary",
    "miracle",
    "cure",
    "guaranteed",
    "secret",
    "exclusive",
    "limited offer",
    "buy now",
    "special offer",
  ];
  
  if (promotionalWords.some(word => text.includes(word.toLowerCase()))) {
    console.log(`      ⊘ Promotional language detected`);
    return false;
  }

  return true;
}

/**
 * Tjek hvis artikel matcher vores interesse-områder
 */
function isInDateRange(pubDate, daysBack) {
  if (!pubDate) return false;

  const articleDate = new Date(pubDate);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  return articleDate >= cutoffDate && articleDate <= new Date();
}

/**
 * Hent og proces nyheder fra en enkelt feed
 */
async function processFeed(source) {
  console.log(`\n📡 Processing: ${source.name}`);
  console.log(`   Looking back ${source.daysBack} days...`);

  try {
    const feed = await parser.parseURL(source.feed);
    console.log(`✓ Found ${feed.items.length} items`);

    let processed = 0;
    let skipped = 0;

    // Proces de 10 seneste artikler fra hver feed
    for (const item of feed.items.slice(0, 10)) {
      // Tjek dato-range
      if (!isInDateRange(item.pubDate, source.daysBack)) {
        skipped++;
        continue;
      }

      // ===== ÆNDRING 4: BRUG NY isHighQuality FUNKTION =====
      // Tjek kvalitet med ny funktion (4 checks i stedet for 1)
      if (!isHighQuality(item.title, item.content || item.summary, source.name)) {
        skipped++;
        continue;
      }

      // Tjek hvis artikel allerede eksisterer
      if (await articleExists(item.title)) {
        console.log(`⊘ Already exists: ${item.title.substring(0, 50)}...`);
        skipped++;
        continue;
      }

      // Generer resumé med Claude
      console.log(`🤖 Generating summary for: ${item.title.substring(0, 50)}...`);
      const excerpt = await generateSummary(
        item.title,
        item.content || item.summary
      );

      if (!excerpt) {
        console.log(`⚠ Failed to generate summary, skipping...`);
        skipped++;
        continue;
      }

      // Kategorisering
      const category = categorizeArticle(item.title, item.content);
      const image = selectEmoji(category);

      // Indsæt i database
      const { error } = await supabase.from("news_articles").insert({
        title: item.title,
        excerpt: excerpt,
        category: category,
        source: source.name,
        date: item.pubDate ? new Date(item.pubDate) : new Date(),
        image: image,
      });

      if (error) {
        console.error(`❌ Error inserting article: ${error.message}`);
        skipped++;
      } else {
        console.log(`✅ Added: ${item.title.substring(0, 60)}...`);
        processed++;
      }

      // Ventning mellem API calls (respekt for rate limits)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(
      `Summary: ${processed} added, ${skipped} skipped from this feed`
    );
    return processed;
  } catch (error) {
    console.error(`❌ Error processing feed: ${error.message}`);
    return 0;
  }
}

/**
 * Main funktion
 */
async function main() {
  console.log("🚀 Starting Frost&Fire Historical News Fetcher (UPDATED)");
  console.log(`📅 ${new Date().toISOString()}`);
  console.log("================================\n");

  let totalProcessed = 0;

  // Proces alle feeds
  for (const source of SOURCES) {
    const count = await processFeed(source);
    totalProcessed += count;

    // Ventning mellem feeds
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("\n================================");
  console.log(`✨ Completed! Total articles added: ${totalProcessed}`);
  console.log("Your Frost&Fire database is now populated with quality content!");
  console.log("Sources include peer-reviewed journals AND quality science journalism!");
}

// Kør main funktion
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
