// Turn a résumé file into plain text inside the side panel. Nothing is uploaded.
// The PDF and Word readers load only when someone picks a file.

const MAX_BYTES = 10 * 1024 * 1024;

export async function readResumeFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB. Try a smaller PDF or Word file.");
  const name = file.name.toLowerCase();
  const data = await file.arrayBuffer();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 5); n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      // Rebuild lines from the text positions so headings and job lines stay separate.
      let line = "";
      let lastY: number | undefined;
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > 2) {
          lines.push(line);
          line = "";
        }
        line += (line && !line.endsWith(" ") && item.str && !item.str.startsWith(" ") ? "  " : "") + item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
        lastY = y;
      }
      lines.push(line);
      pages.push(lines.map((l) => l.replace(/\s{3,}/g, "  ")).join("\n"));
    }
    return pages.join("\n");
  }

  if (name.endsWith(".docx") || file.type.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const result = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: data });
    return result.value;
  }

  if (name.endsWith(".doc")) throw new Error("Old .doc files can't be read. Save it as .docx or PDF and try again.");
  if (name.endsWith(".txt") || file.type.startsWith("text/")) return new TextDecoder().decode(data);
  throw new Error("Choose a PDF or Word (.docx) file.");
}
