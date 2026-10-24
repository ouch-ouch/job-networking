/**
 * Remembers the order in which job-context and profile versions arrive, so a
 * draft built on a version that has since been replaced returns stale_context.
 * Hackathon scope: one user, in memory.
 */
export class VersionTracker {
  private readonly jobVersions = new Map<string, string[]>();
  private readonly profileVersions: string[] = [];

  private static observe(list: string[], version: string): boolean {
    const i = list.indexOf(version);
    if (i === -1) {
      list.push(version);
      return false;
    }
    return i < list.length - 1;
  }

  /** Records the versions and reports whether either is older than the latest seen. */
  observe(jobContextId: string, jobContextVersion: string, profileVersion: string): { staleJob: boolean; staleProfile: boolean } {
    const list = this.jobVersions.get(jobContextId) ?? [];
    this.jobVersions.set(jobContextId, list);
    return {
      staleJob: VersionTracker.observe(list, jobContextVersion),
      staleProfile: VersionTracker.observe(this.profileVersions, profileVersion),
    };
  }
}
