import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/generate-docx-from-md.mjs <input.md> <output.docx>");
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const markdown = fs.readFileSync(inputPath, "utf8");
const lines = markdown.split(/\r?\n/);

const paragraphs = [];

const makeHeading = (text, level) => {
  const clean = text.replace(/^#+\s*/, "").trim();
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
  };
  return new Paragraph({ text: clean, heading: map[level] || HeadingLevel.HEADING_4 });
};

for (const rawLine of lines) {
  const line = rawLine ?? "";

  if (/^\s*$/.test(line)) {
    paragraphs.push(new Paragraph({ text: "" }));
    continue;
  }

  const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    paragraphs.push(makeHeading(line, headingMatch[1].length));
    continue;
  }

  const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
  if (bulletMatch) {
    paragraphs.push(
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: bulletMatch[1].trim() })],
      }),
    );
    continue;
  }

  if (/^\|.*\|$/.test(line)) {
    paragraphs.push(new Paragraph({ text: line.trim() }));
    continue;
  }

  const cleaned = line
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)");

  paragraphs.push(new Paragraph({ text: cleaned }));
}

const doc = new Document({
  sections: [
    {
      properties: {},
      children: paragraphs,
    },
  ],
});

const outDir = path.dirname(outputPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outputPath, buffer);
console.log(`DOCX generated: ${outputPath}`);
