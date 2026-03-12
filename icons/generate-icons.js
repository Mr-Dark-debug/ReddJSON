/**
 * Icon Generator Script for ReddJSON
 *
 * This script creates PNG icons from the SVG template.
 * Run this script with Node.js to generate the icons:
 *
 *   node generate-icons.js
 *
 * Requirements:
 *   - Node.js
 *   - No external dependencies (uses built-in canvas-like rendering)
 *
 * Alternative: Open icon-generator.html in a browser and download each icon.
 */

const fs = require('fs');
const path = require('path');

// SVG template for the ReddJSON icon
const createSvgIcon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FF4500"/>
      <stop offset="100%" style="stop-color:#FF6B35"/>
    </linearGradient>
  </defs>

  <!-- Background circle -->
  <circle cx="64" cy="64" r="60" fill="url(#bgGradient)"/>

  <!-- Inner circle for depth -->
  <circle cx="64" cy="64" r="54" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>

  <!-- JSON curly braces icon -->
  <g fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    <!-- Left brace -->
    <path d="M38 35 C28 35 22 44 22 54 L22 64 C22 74 16 78 10 78 C16 78 22 84 22 94 L22 104 C22 114 28 121 38 121"/>
    <!-- Right brace -->
    <path d="M90 35 C100 35 106 44 106 54 L106 64 C106 74 112 78 118 78 C112 78 106 84 106 94 L106 104 C106 114 100 121 90 121"/>
  </g>

  <!-- Decorative dots -->
  <circle cx="64" cy="50" r="5" fill="#FFFFFF"/>
  <circle cx="64" cy="78" r="5" fill="#FFFFFF"/>
</svg>`;

// Icon sizes to generate
const sizes = [16, 48, 128];

// Generate SVG files for each size
const iconsDir = __dirname;

sizes.forEach(size => {
  const svg = createSvgIcon(size);
  const filename = path.join(iconsDir, `icon-${size}.svg`);
  fs.writeFileSync(filename, svg);
  console.log(`Created: icon-${size}.svg`);
});

// Also save the main SVG without size constraints
const mainSvg = createSvgIcon(128).replace(/width="128" height="128"/, 'width="128" height="128"');
fs.writeFileSync(path.join(iconsDir, 'reddjson.svg'), mainSvg);
console.log('Created: reddjson.svg');

console.log('\n---');
console.log('SVG icons have been created!');
console.log('\nTo convert SVG to PNG:');
console.log('1. Open icon-generator.html in Chrome');
console.log('2. Click each "Download" button');
console.log('3. Save the PNG files to this folder');
console.log('\nOr use an online converter like cloudconvert.com');
