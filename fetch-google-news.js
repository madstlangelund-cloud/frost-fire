#!/usr/bin/env node

require('dotenv').config();
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const Parser = require("rss-parser");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const parser = new Parser();

// Google News feeds som altid virker
const FEEDS = [
  "https://news.google.com/rss/search?q=sauna+health",
  "https://news.google.com/rss/search?q=cold+water+immersion",
  "https://news.google.com/rss/search?q=winter+swimming+health",
  "https://news.google.com/rss/search?q=thermal+therapy",
];

async function fetchAndSave() {
  console.log("🚀 Starting Google News Fetcher");
  console.log("================================\n");

  let totalAdded = 0;

  for (const feedUrl of FEEDS) {
    try {
      console.log(`📡 Fetching: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);
      console.log(`✓ Found ${feed.items.length} articles\n`);

      for (const item of feed.items.slice(0, 5)) {
        try {
          const text = (item.title + " " + (item.content || "")).toLowerCase();
          let category = "health";
          if (text.includes("sauna")) category = "sauna";
          else if (text.includes("cold") || text.includes("winter")) category = "cold";

          const message = await client.messages.create({
            model: "claude-opus-4-5-20251101",
            max_tokens: 150,
            messages: [
              {
                role: "user",
                content: `Write 1 sentence summary in English: "${item.title}". Be concise.`,
              },
            ],
          });

          const excerpt = message.content[0].text;

          await supabase.from("news_articles").insert({
            title: item.title,
            excerpt: excerpt,
            category: category,
            source: "Google News",
            date: new Date(item.pubDate),
            image: category === "sauna" ? "🔥" : category === "cold" ? "❄️" : "💪",
          });

          console.log(`  ✅ Added: ${item.title.substring(0, 50)}...`);
          totalAdded++;

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.log(`  ⊘ Skipped`);
        }
      }
    } catch (err) {
      console.error(`❌ Error with feed: ${err.message}`);
    }
  }

  console.log("\n================================");
  console.log(`✨ Completed! Total articles added: ${totalAdded}`);
}

fetchAndSave().catch(console.error);