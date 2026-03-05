#!/usr/bin/env node

/**
 * Frost&Fire Automated News Fetcher
 * 
 * Denne script:
 * 1. Henter nyheder fra videnskabelige feeds
 * 2. Bruger Claude API til at skrive resuméer
 * 3. Gemmer i Supabase database
 * 
 * Setup:
 * 1. npm install anthropic rss-parser @supabase/supabase-js
 * 2. Sæt environment variables (se nedenfor)
 * 3. Kør: node fetch-science-news.js
 * 4. Opsæt GitHub Actions for automatisk ukentlig kørsel
 */

require('dotenv').config();
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const Parser = require("rss-parser");

// Environment variables
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

// Videnskabelige RSS feeds relevant til sauna & vinterbadning
const FEEDS = [
  // Science Daily - Exercise & Fitness
  "https://www.sciencedaily.com/rss/health_medicine/exercise_fitness.xml",
  
  // Nature - Health Sciences
  "https://www.nature.com/nature/current_issue/rss",
  
  // Cell Press - Multiple journals
  "https://www.cell.com/heliyon/rss",
  
  // BMC Health Services Research
  "https://bmchealthservres.biomedcentral.com/articles?type=research",
  
  // PubMed Central (hvis du vil være mere avanceret)
  // "https://www.ncbi.nlm.nih.gov/pmc/rss/",
];

// Søgeord som hjælper med at filtrer relevante artikler
const KEYWORDS = [
  "sauna",
  "cold water",
  "winter swimming",
  "heat stress",
  "cold exposure",
  "thermal stress",
  "cardiovascular",
  "immune",
  "mitochondria",
  "brown fat",
  "thermogenesis",
];

/**
 * Tjek hvis artikel allerede eksisterer i databasen
 */
async function articleExists(title) {
  const { data } = await supabase
    .from("news_articles")
    .select("id")
    .eq("title", title)
    .single();

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
          content: `You are a science journalist. Write a short 1-2 sentence summary in English of this article about sauna and cold water immersion. Focus on the key health finding. Be clear so anyone can understand.

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
 * Tjek hvis artikel matcher vores interesse-områder
 */
function isRelevant(title, content) {
  const text = (title + " " + (content || "")).toLowerCase();
  return KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * Hent og proces nyheder fra en enkelt feed
 */
async function processFeed(feedUrl) {
  console.log(`\n📡 Processing feed: ${feedUrl}`);

  try {
    const feed = await parser.parseURL(feedUrl);
    console.log(`✓ Found ${feed.items.length} items`);

    let processed = 0;
    let skipped = 0;

    // Proces de 10 seneste artikler fra hver feed
    for (const item of feed.items.slice(0, 10)) {
      // Tjek relevans
      if (!isRelevant(item.title, item.content || item.summary)) {
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
        source: feed.title || "Science Daily",
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
  console.log("🚀 Starting Frost&Fire News Fetcher");
  console.log(`📅 ${new Date().toISOString()}`);
  console.log("================================\n");

  let totalProcessed = 0;

  // Proces alle feeds
  for (const feedUrl of FEEDS) {
    const count = await processFeed(feedUrl);
    totalProcessed += count;

    // Ventning mellem feeds
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("\n================================");
  console.log(`✨ Completed! Total articles added: ${totalProcessed}`);
  console.log("Next update scheduled for next week.");
}

// Kør main funktion
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
