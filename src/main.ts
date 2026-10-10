import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/main.css';
import { App } from './app/App';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const ui = document.getElementById('ui')!;
if (!webglAvailable()) {
  ui.innerHTML = `<div class="fatal"><h1>APS-U Beamline Explorer</h1><p>This exhibit needs a browser with WebGL 2 enabled.</p></div>`;
} else {
  const app = new App(document.getElementById('stage')!, document.getElementById('labels')!, ui);
  (window as unknown as { __app: App }).__app = app;
}
