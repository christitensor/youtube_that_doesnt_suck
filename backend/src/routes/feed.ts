import { Router } from "express";
import { env } from "../env.js";
import { buildPodcastFeedXml } from "../services/feed.js";

export const feedRouter = Router();

feedRouter.get("/:token.xml", (req, res) => {
  if (req.params.token !== env.FEED_TOKEN) {
    res.status(404).send("Not found");
    return;
  }
  res.type("application/rss+xml").send(buildPodcastFeedXml());
});
