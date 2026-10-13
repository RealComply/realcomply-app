// The walkthrough videos on Getting started (app/dashboard/getting-started).
// Both are unlisted on YouTube and embedded through youtube-nocookie.com.
//
// Which videos (brief, 14 Oct 2026): agents see the agent video, licensees see
// both. "Agents" is everyone who is not the licensee in charge of an office:
// agents invited by their office, agents on their own plan (never treated as
// the licensee here) and assistants. The agent welcome email's picture links
// to Getting started.

export type Video = { id: string; title: string; length: string };

export const LICENSEE_VIDEO: Video = { id: "xzAW28t758g", title: "RealComply for licensees", length: "3 min 40" };
export const AGENT_VIDEO: Video = { id: "l8KbqTAegLc", title: "RealComply for agents", length: "1 min 46" };

export function videosFor(access: { officeLicensee: boolean }): Video[] {
  return access.officeLicensee ? [LICENSEE_VIDEO, AGENT_VIDEO] : [AGENT_VIDEO];
}
