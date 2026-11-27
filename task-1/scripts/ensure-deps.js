const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const modules = path.join(root, 'node_modules');

if (!fs.existsSync(modules)) {
  console.log('node_modules missing; running npm install...');
  execSync('npm install', { cwd: root, stdio: 'inherit' });
}
