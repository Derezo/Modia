import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceRoot = path.join(
  root,
  "ai-image-metadata/characters/player-animation-sources",
);
const outputRoot = path.join(root, "tmp/player-reference-review");
const races = ["human", "dwarf", "elf", "orc", "vampire"];
const genders = ["male", "female", "other"];
const classes = [
  "berserker",
  "paladin",
  "guardian",
  "warlord",
  "sorcerer",
  "summoner",
  "conjurer",
  "oracle",
  "ninja",
  "martial_artist",
  "brawler",
  "ascetic",
  "alchemist",
  "medic",
  "plague_doctor",
  "artificer",
];
const tile = 256;
const labelHeight = 28;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

await fs.mkdir(outputRoot, { recursive: true });

for (const race of races) {
  for (const gender of genders) {
    const composites = [];
    for (const [index, playerClass] of classes.entries()) {
      const id = `${race}_${gender}_${playerClass}`;
      const input = path.join(sourceRoot, id, "reference.png");
      const image = await sharp(input)
        .resize(tile, tile - labelHeight, { fit: "contain" })
        .extend({
          top: labelHeight,
          bottom: 0,
          left: 0,
          right: 0,
          background: "#252a33",
        })
        .png()
        .toBuffer();
      const label = Buffer.from(
        `<svg width="${tile}" height="${labelHeight}">
          <rect width="100%" height="100%" fill="#252a33"/>
          <text x="8" y="19" fill="white" font-size="14"
            font-family="sans-serif">${escapeXml(playerClass)}</text>
        </svg>`,
      );
      composites.push({
        input: image,
        left: (index % 4) * tile,
        top: Math.floor(index / 4) * tile,
      });
      composites.push({
        input: label,
        left: (index % 4) * tile,
        top: Math.floor(index / 4) * tile,
      });
    }
    await sharp({
      create: {
        width: tile * 4,
        height: tile * 4,
        channels: 4,
        background: "#15181e",
      },
    })
      .composite(composites)
      .png()
      .toFile(path.join(outputRoot, `${race}_${gender}.png`));
  }
}

console.log(`Wrote 15 reference review sheets to ${outputRoot}`);
