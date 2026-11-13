/**
 * One result comment and one fix-request comment, updated in place.
 * GitHub issue comments have no binary attachment field, so the JPEG stays
 * in the job artifacts and the comment names the file the parser extracted.
 */

export function createGitHub({ token, repository, prNumber, fetchImpl = fetch }) {
  const [owner, repo] = String(repository).split("/");
  if (!owner || !repo) throw new Error(`GITHUB_REPOSITORY must be owner/name, got ${repository}`);

  async function request(pathname, { method = "GET", body } = {}) {
    const response = await fetchImpl(`https://api.github.com${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "kane-pr-guard",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message = data && typeof data === "object" && data.message ? data.message : response.status;
      throw new Error(`GitHub ${method} ${pathname} failed: ${message}`);
    }
    return data;
  }

  async function listComments() {
    const comments = await request(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`);
    return Array.isArray(comments) ? comments : [];
  }

  async function upsert(marker, body) {
    const comments = await listComments();
    // Match the marker anywhere in the body. The fix request starts with the
    // @cursor mention, and <!-- kane-pr-guard-fix --> is kept later in the body.
    const existing = [...comments].reverse().find((comment) => commentHasMarker(comment.body, marker));
    if (existing) {
      return request(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        method: "PATCH",
        body: { body },
      });
    }
    return request(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      body: { body },
    });
  }

  return { listComments, upsert };
}

export function commentHasMarker(body, marker) {
  return Boolean(body && String(body).includes(marker));
}
