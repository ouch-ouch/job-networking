/** Reads visible page text, with specific selectors for common job boards. */
export function extractJobPage(root: Document = document): string {
  const selectors = [
    "#job-details",
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    '[data-test-id="job-description"]',
    '[data-testid="job-description"]',
    "#job_description",
    ".job__description",
    ".posting-page .content",
    ".posting-page",
    "#content",
    "main",
    "article",
    '[role="main"]',
  ];
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    if (
      !element ||
      !element.getClientRects().length ||
      element.closest("[hidden]")
    )
      continue;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const body = (element?.innerText || element?.textContent || "")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body.length < 80) continue;
    const title = root
      .querySelector("h1")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    return (
      title && !body.includes(title) ? `${title}\n\n${body}` : body
    ).slice(0, 50_000);
  }
  throw new Error(
    "No readable job description was found. Open the full job posting, or paste its description in Targets.",
  );
}
