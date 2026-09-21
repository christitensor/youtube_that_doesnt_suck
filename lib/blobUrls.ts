// Helpers for reading finished media out of the (private) Blob store.
//
// The browser/podcast app fetches media straight from Blob's CDN using a
// short-lived presigned URL instead of proxying bytes through a Vercel
// Function: Functions cap response bodies (~4.5 MB unless streamed), have a
// max duration, and would have to implement HTTP Range by hand - which iOS
// Safari requires before it will play an mp4 at all. The CDN handles Range,
// caching and arbitrarily large files natively.
import { get, issueSignedToken, presignUrl } from "@vercel/blob";

// Long enough to outlast any video someone is actually watching; a fresh
// URL is minted on every Play tap / feed fetch anyway.
const READ_URL_TTL_MS = 12 * 60 * 60 * 1000;

/** A time-limited, unauthenticated GET URL for one private blob. */
export async function presignedReadUrl(pathname: string): Promise<string> {
  const validUntil = Date.now() + READ_URL_TTL_MS;
  const signed = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(signed, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}

/** Size in bytes of a private blob, or null if it doesn't exist. Opens the
 * blob and immediately cancels the body, so nothing is actually downloaded. */
export async function privateBlobSize(pathname: string): Promise<number | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  await result.stream.cancel().catch(() => {});
  return result.blob.size;
}
