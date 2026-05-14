import * as Tone from 'tone';
import { useState, useCallback, useEffect, useRef } from 'react';

export function useAudio() {
  const [isStarted, setIsStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [evolution, setEvolution] = useState(0); // 0 to 1
  const droneRef = useRef<Tone.Oscillator | null>(null);
  const analyzerRef = useRef<Tone.Analyser | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const synthsRef = useRef<Tone.PolySynth<any>[]>([]);

  useEffect(() => {
    // Basic setup
    droneRef.current = new Tone.Oscillator({
      frequency: "C2",
      type: "sine",
      volume: -20
    }).toDestination();

    // Instrument 1: Crystal / Bell
    const crystal = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 2 },
      volume: -10
    }).toDestination();

    // Instrument 2: Pluck / String
    const pluck = new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: "square" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.2 },
      filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1, baseFrequency: 200, octaves: 4 },
      volume: -12
    }).toDestination();

    // Instrument 3: Soft Pad
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.5, decay: 0.5, sustain: 0.8, release: 1 },
      volume: -15
    }).toDestination();

    // Instrument 4: Digital Pulse
    const pulse = new Tone.PolySynth(Tone.FMSynth, {
      modulationIndex: 12.22,
      envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.5 },
      modulation: { type: "square" },
      modulationEnvelope: { attack: 0.2, decay: 0.01, sustain: 1, release: 0.5 },
      volume: -18
    }).toDestination();

    // Instrument 5: Wooden / Mallet
    const mallet = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      volume: -8
    }).toDestination();

    // Instrument 6: Electric Tine
    const tine = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: 3.125,
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 1 },
      modulation: { type: "triangle" },
      modulationEnvelope: { attack: 0.5, decay: 0, sustain: 1, release: 0.5 },
      volume: -14
    }).toDestination();

    // Instrument 7: Cyber Bass
    const bass = new Tone.PolySynth(Tone.DuoSynth, {
      vibratoAmount: 0.5,
      vibratoRate: 5,
      harmonicity: 1.5,
      voice0: {
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 }
      },
      voice1: {
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 }
      },
      volume: -16
    }).toDestination();

    // Instrument 8: Metallic Spark
    const spark = new Tone.PolySynth(Tone.FMSynth, {
      modulationIndex: 30,
      harmonicity: 4.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
      modulation: { type: "sine" },
      volume: -20
    }).toDestination();

    synthsRef.current = [crystal, pluck, pad, pulse, mallet, tine, bass, spark];

    analyzerRef.current = new Tone.Analyser("waveform", 1024);
    Tone.getDestination().connect(analyzerRef.current);

    // Evolving loop
    loopRef.current = new Tone.Loop((time) => {
      const notes = ["C2", "G2", "C3", "Eb3"];
      const note = notes[Math.floor(Math.random() * notes.length)];
      const randomSynth = synthsRef.current[Math.floor(Math.random() * synthsRef.current.length)];
      randomSynth.triggerAttackRelease(note, "16n", time);
    }, "4n");

    return () => {
      droneRef.current?.dispose();
      synthsRef.current.forEach(s => s.dispose());
      loopRef.current?.dispose();
    };
  }, []);

  const startAudio = useCallback(async () => {
    await Tone.start();
    droneRef.current?.start();
    loopRef.current?.start(0);
    Tone.getTransport().start();
    setIsStarted(true);
  }, []);

  const stopAudio = useCallback(() => {
    droneRef.current?.stop();
    loopRef.current?.stop();
    Tone.getTransport().stop();
    setIsStarted(false);
    setEvolution(0);
  }, []);

  const triggerNote = useCallback((note: string = "C4") => {
    if (synthsRef.current.length > 0) {
      const idx = Math.floor(Math.random() * synthsRef.current.length);
      synthsRef.current[idx].triggerAttackRelease(note, "8n");
    }
  }, []);

  const setMusicEvolution = useCallback((val: number) => {
    setEvolution(val);
    if (droneRef.current) {
      droneRef.current.frequency.value = 65.41 * (1 + val * 0.5);
    }
    if (loopRef.current) {
      Tone.getTransport().bpm.value = 60 + val * 120;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    Tone.getDestination().mute = nextMute;
  }, [isMuted]);

  const getAudioData = useCallback(() => {
    if (!analyzerRef.current) return new Float32Array(1024);
    return analyzerRef.current.getValue() as Float32Array;
  }, []);

  return { 
    isStarted, 
    isMuted,
    toggleMute,
    startAudio, 
    stopAudio,
    triggerNote, 
    setMusicEvolution, 
    evolution,
    getAudioData 
  };
}
