import { Config } from '@remotion/cli/config';

// Deterministic, high-quality master. PNG frames: lossless text edges and a limited-range yuv420p encode.
Config.setVideoImageFormat('png');

Config.setCodec('h264');
Config.setCrf(14);
Config.setPixelFormat('yuv420p');
Config.setConcurrency(4);
Config.setChromiumOpenGlRenderer('swangle');
// Cloud container: Playwright's headless shell. Remove locally to use Remotion's own browser.
if (process.env.AWJ_CHROME) Config.setBrowserExecutable(process.env.AWJ_CHROME);
