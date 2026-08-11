import express from "express";
import cors from "cors";
import cron from "node-cron";
import { env } from "./env.js";
import { apiRouter } from "./routes/api.js";
import { feedRouter } from "./routes/feed.js";
import { syncWatchLaterPlaylist } from "./services/youtube.js";
import { runAutoPodcastExtraction } from "./services/autoPodcast.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", apiRouter);
app.use("/feed", feedRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

async function syncAndExtract() {
  try {
    const result = await syncWatchLaterPlaylist();
    console.log(`[sync] added ${result.added} new videos (${result.total} total in playlist)`);
    const extraction = await runAutoPodcastExtraction();
    if (extraction.processed || extraction.failed) {
      console.log(`[podcast] extracted ${extraction.processed}, failed ${extraction.failed}`);
    }
  } catch (err) {
    console.error("[sync] failed:", err);
  }
}

cron.schedule(`*/${env.SYNC_INTERVAL_MINUTES} * * * *`, syncAndExtract);

app.listen(env.PORT, () => {
  console.log(`Server listening on :${env.PORT}`);
  syncAndExtract();
});
