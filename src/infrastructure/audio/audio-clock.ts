export class AudioClock {
  private context?: AudioContext;
  private buffer?: AudioBuffer;
  private source?: AudioBufferSourceNode;
  private startedAt = 0;
  private silentStartedAt = 0;
  private silent = false;
  private stoppedAt = 0;
  private acceptingInputSince?: DOMHighResTimeStamp;

  async load(audioUrl: string): Promise<void> {
    if (!audioUrl) {
      this.silent = true;
      return;
    }
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error("Could not load the music file");
    const audioData = await response.arrayBuffer();
    this.context ??= new AudioContext();
    this.buffer = await this.context.decodeAudioData(audioData.slice(0));
  }

  async start(): Promise<void> {
    this.stop();
    this.stoppedAt = 0;
    if (this.silent) {
      this.silentStartedAt = performance.now();
      this.acceptingInputSince = this.silentStartedAt;
      return;
    }
    if (!this.context || !this.buffer) throw new Error("Audio is not loaded");
    await this.context.resume();
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.context.destination);
    this.startedAt = this.context.currentTime + 0.08;
    this.source.start(this.startedAt);
    this.acceptingInputSince = performance.now();
  }

  async pause(): Promise<void> {
    if (this.acceptingInputSince !== undefined) {
      this.stoppedAt = Math.max(0, this.songTimeAt(performance.now()));
    }
    this.acceptingInputSince = undefined;
    await this.context?.suspend();
  }

  async resume(): Promise<void> {
    if (this.silent) this.silentStartedAt = performance.now() - this.stoppedAt * 1000;
    await this.context?.resume();
    this.acceptingInputSince = performance.now();
  }

  currentTime(endTime: number): number {
    const elapsed = this.acceptingInputSince !== undefined
      ? this.songTimeAt(performance.now())
      : this.stoppedAt;
    return Math.min(endTime, Math.max(0, elapsed));
  }

  timeAt(capturedAt: DOMHighResTimeStamp, endTime: number): number | null {
    if (
      (!this.silent && (!this.context || !this.startedAt))
      || this.acceptingInputSince === undefined
      || capturedAt < this.acceptingInputSince
    ) return null;
    return Math.min(endTime, Math.max(0, this.songTimeAt(capturedAt)));
  }

  stop(): void {
    if ((this.silent || (this.context && this.startedAt)) && this.acceptingInputSince !== undefined) {
      this.stoppedAt = Math.max(0, this.songTimeAt(performance.now()));
    }
    this.acceptingInputSince = undefined;
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
    this.silentStartedAt = 0;
  }

  private songTimeAt(performanceTime: DOMHighResTimeStamp): number {
    if (this.silent) return (performanceTime - this.silentStartedAt) / 1000;
    const output = this.context!.getOutputTimestamp();
    return output.contextTime! + (performanceTime - output.performanceTime!) / 1000 - this.startedAt;
  }
}
