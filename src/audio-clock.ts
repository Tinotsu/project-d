export class AudioClock {
  private context?: AudioContext;
  private buffer?: AudioBuffer;
  private source?: AudioBufferSourceNode;
  private startedAt = 0;
  private stoppedAt = 0;

  async load(audioUrl: string): Promise<void> {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error("Could not load the music file");
    const audioData = await response.arrayBuffer();
    this.context ??= new AudioContext();
    this.buffer = await this.context.decodeAudioData(audioData.slice(0));
  }

  async start(): Promise<void> {
    if (!this.context || !this.buffer) throw new Error("Audio is not loaded");
    this.stop();
    this.stoppedAt = 0;
    await this.context.resume();
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.context.destination);
    this.startedAt = this.context.currentTime + 0.08;
    this.source.start(this.startedAt);
  }

  async pause(): Promise<void> {
    await this.context?.suspend();
  }

  async resume(): Promise<void> {
    await this.context?.resume();
  }

  currentTime(endTime: number): number {
    const elapsed = this.context && this.startedAt ? this.context.currentTime - this.startedAt : this.stoppedAt;
    return Math.min(endTime, Math.max(0, elapsed));
  }

  stop(): void {
    if (this.context && this.startedAt) this.stoppedAt = Math.max(0, this.context.currentTime - this.startedAt);
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // The source may not have started yet.
      }
      this.source.disconnect();
      this.source = undefined;
    }
    this.startedAt = 0;
  }
}
