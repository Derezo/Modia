import {
  PARCHMENT_COLORS,
  getParchmentBorder,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentScrollbarCSS
} from '../../ui/parchment/index.js';

export function ensureFishingStyles() {
  if (document.getElementById('fishing-scene-styles')) return;
  const P = PARCHMENT_COLORS;
  const style = document.createElement('style');
  style.id = 'fishing-scene-styles';
  style.textContent = `
    .fishing-shell {
      position: absolute; inset: 0; display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      color: ${P.text.primary}; font-family: Georgia, 'Times New Roman', serif;
      background: linear-gradient(rgba(21,35,39,.18), rgba(21,35,39,.34));
    }
    .fishing-header, .fishing-footer {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 18px; background: ${getParchmentGradientTextured()};
      border-bottom: ${getParchmentBorder(2)}; box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .fishing-footer { border-bottom: 0; border-top: ${getParchmentBorder(2)}; justify-content: flex-end; }
    .fishing-header h2 { margin: 0; font-size: 21px; }
    .fishing-session-summary { display: flex; align-items: center; gap: 12px; font-size: 13px; }
    .fishing-phase { padding: 4px 10px; border-radius: 999px; color: #fff; background: #456d64; font-weight: bold; }
    .fishing-layout {
      min-height: 0; display: grid; grid-template-columns: minmax(170px, 220px) minmax(300px, 1fr) minmax(190px, 250px);
      gap: 12px; padding: 12px;
    }
    .fishing-panel {
      min-height: 0; padding: 12px; border: ${getParchmentBorder()};
      border-radius: 8px; background: ${getParchmentGradient()}; box-shadow: 0 3px 10px rgba(0,0,0,.22);
      overflow: auto;
    }
    .fishing-side-panels { min-height: 0; display: grid; grid-template-rows: 1fr 1fr; gap: 12px; }
    .fishing-panel h3 { margin: 0 0 9px; font-size: 15px; }
    .fishing-field { display: grid; gap: 4px; margin-bottom: 12px; font-size: 12px; font-weight: bold; }
    .fishing-field select {
      width: 100%; padding: 8px; border: 1px solid ${P.borderDark}; border-radius: 5px;
      color: ${P.text.primary}; background: ${P.light}; font: inherit;
    }
    .fishing-gear-preview { min-height: 48px; display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .fishing-pond-panel {
      position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
      min-height: 330px; padding: 18px; border: 2px solid rgba(229,211,160,.68); border-radius: 10px;
      background: linear-gradient(transparent 25%, rgba(10,32,43,.22)); overflow: hidden;
    }
    .fishing-controls {
      width: min(440px, 94%); padding: 12px; border-radius: 9px;
      color: #fff; text-align: center; background: rgba(14,31,37,.78); backdrop-filter: blur(3px);
    }
    .fishing-instruction { min-height: 1.4em; margin: 0 0 8px; font-weight: bold; }
    .fishing-result {
      display: grid; gap: 3px; margin: 0 0 10px; padding: 9px 11px;
      border: 2px solid #d8b85d; border-radius: 7px;
      color: #fff7dc; text-align: left; background: rgba(73,47,24,.9);
      box-shadow: 0 2px 7px rgba(0,0,0,.26);
    }
    .fishing-result[hidden] { display: none; }
    .fishing-result strong { font-size: 15px; }
    .fishing-result span { line-height: 1.35; }
    .fishing-result[data-outcome="caught"] {
      border-color: #9fd28c; background: rgba(37,78,51,.92);
    }
    .fishing-power-track, .fishing-countdown-track {
      height: 11px; margin: 7px 0; border-radius: 999px; background: rgba(0,0,0,.48); overflow: hidden;
    }
    .fishing-power-fill, .fishing-countdown-fill {
      width: 0; height: 100%; background: linear-gradient(90deg,#79b865,#e5bd4b,#c85c45);
    }
    .fishing-primary, .fishing-secondary, .fishing-tab, .fishing-cue {
      min-height: 42px; padding: 8px 15px; border: 2px solid #58462d; border-radius: 6px;
      color: #2c2117; background: linear-gradient(#f4e5bc,#cdb37b); font: 700 14px Georgia,serif; cursor: pointer;
    }
    .fishing-primary { color: #fff; background: linear-gradient(#5d8a62,#36583f); border-color: #294632; }
    .fishing-primary:disabled, .fishing-secondary:disabled, .fishing-cue:disabled { opacity: .5; cursor: not-allowed; }
    .fishing-primary:focus-visible, .fishing-secondary:focus-visible, .fishing-tab:focus-visible,
    .fishing-cue:focus-visible, .fishing-field select:focus-visible {
      outline: 3px solid #ffe070; outline-offset: 2px;
    }
    .fishing-cues { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; }
    .fishing-cue[aria-pressed="true"] { color: #fff; background: #815b34; }
    .fishing-list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
    .fishing-list li { display: flex; justify-content: space-between; gap: 8px; padding: 6px; border-bottom: 1px solid rgba(99,77,48,.22); }
    .fishing-rarity { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    .fishing-basket-value { color: ${P.accent.gold}; font-weight: bold; }
    .fishing-empty { padding: 16px 4px; color: ${P.text.muted}; text-align: center; font-style: italic; }
    .fishing-mobile-tabs { display: none; }
    .fishing-settlement {
      margin: 8px 0; padding: 8px; border: 1px solid ${P.border}; border-radius: 5px; background: rgba(255,255,255,.26);
    }
    .fishing-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    ${getParchmentScrollbarCSS('.fishing-panel')}
    @media (max-width: 768px) {
      .fishing-layout { grid-template-columns: 1fr; padding: 8px; }
      .fishing-pond-panel { min-height: 360px; order: 1; }
      .fishing-side-panels { display: contents; }
      .fishing-panel { display: none; max-height: 38vh; order: 2; }
      .fishing-panel.mobile-active { display: block; }
      .fishing-mobile-tabs { display: flex; gap: 5px; padding: 0 8px 8px; order: 2; }
      .fishing-mobile-tabs .fishing-tab { flex: 1; }
      .fishing-header { padding: 8px 12px; }
      .fishing-session-summary { gap: 6px; }
      .fishing-footer { padding: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .fishing-shell *, .fishing-shell *::before, .fishing-shell *::after {
        animation-duration: .001ms !important; animation-iteration-count: 1 !important;
        scroll-behavior: auto !important; transition-duration: .001ms !important;
      }
    }
  `;
  document.head.appendChild(style);
}
