import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const metadataRoot = path.join(root, "ai-image-metadata/characters");
const sourceRoot = path.join(metadataRoot, "player-animation-sources");
const specRoot = path.join(metadataRoot, "player-authored-animations");
const outputRoot = path.join(root, "tmp/player-action-review");
const races = ["human", "dwarf", "elf", "orc", "vampire"];
const genders = ["male", "female", "other"];
const classes = [
  "berserker", "paladin", "guardian", "warlord",
  "sorcerer", "summoner", "conjurer", "oracle",
  "ninja", "martial_artist", "brawler", "ascetic",
  "alchemist", "medic", "plague_doctor", "artificer",
];
const actions = ["idle", "walk", "attack", "cast", "hurt", "victory", "death"];
const tileWidth = 220;
const tileHeight = 142;
const rowLabelWidth = 150;
const columnLabelHeight = 34;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function labelSvg(width, height, text, fontSize = 14) {
  return Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#252a33"/>
      <text x="8" y="${Math.round(height / 2 + fontSize / 3)}"
        fill="white" font-size="${fontSize}" font-family="sans-serif">
        ${escapeXml(text)}
      </text>
    </svg>`,
  );
}

await fs.mkdir(outputRoot, { recursive: true });

for (const race of races) {
  for (const gender of genders) {
    if (race === "human" && gender === "male") continue;
    const composites = [];

    for (const [column, action] of actions.entries()) {
      composites.push({
        input: labelSvg(tileWidth, columnLabelHeight, action, 15),
        left: rowLabelWidth + column * tileWidth,
        top: 0,
      });
    }

    for (const [row, playerClass] of classes.entries()) {
      const id = `${race}_${gender}_${playerClass}`;
      const spec = JSON.parse(
        await fs.readFile(path.join(specRoot, `${id}.json`), "utf8"),
      );
      const generatedActions = new Set(
        Object.keys(spec.animations).filter((action) => action !== "dead"),
      );
      const top = columnLabelHeight + row * tileHeight;
      composites.push({
        input: labelSvg(rowLabelWidth, tileHeight, playerClass, 13),
        left: 0,
        top,
      });

      for (const [column, action] of actions.entries()) {
        if (!generatedActions.has(action)) continue;
        const input = path.join(sourceRoot, id, `${action}.png`);
        try {
          await fs.access(input);
        } catch {
          continue;
        }
        const image = await sharp(input)
          .resize(tileWidth, tileHeight, {
            fit: "contain",
            background: "#15181e",
          })
          .png()
          .toBuffer();
        composites.push({
          input: image,
          left: rowLabelWidth + column * tileWidth,
          top,
        });
      }
    }

    await sharp({
      create: {
        width: rowLabelWidth + actions.length * tileWidth,
        height: columnLabelHeight + classes.length * tileHeight,
        channels: 4,
        background: "#15181e",
      },
    })
      .composite(composites)
      .png()
      .toFile(path.join(outputRoot, `${race}_${gender}.png`));
  }
}

console.log(`Wrote 14 action review sheets to ${outputRoot}`);
