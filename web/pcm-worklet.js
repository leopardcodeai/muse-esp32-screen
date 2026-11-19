// pcm-worklet.js: hands the microphone's Float32 blocks to the main thread.
//
// The main thread downsamples and converts them (pcm.js). A processor must return true
// to stay alive; the port is closed when the microphone stops.
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor("muse-pcm", PCMProcessor);
