import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAudio } from './hooks/useAudio';
import { MainProcessor } from './components/MainProcessor';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Home } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { ParticleScene } from './components/Visuals/ParticleScene';
import * as Tone from 'tone';
import * as THREE from 'three';

export default function App() {
  const { isStarted, isMuted, toggleMute, startAudio, stopAudio, triggerNote, setMusicEvolution, evolution, getAudioData } = useAudio();
  const [audioData, setAudioData] = useState(new Float32Array(1024));
  const [flowText, setFlowText] = useState<string | undefined>(undefined);
  const [activeNodes, setActiveNodes] = useState<string[]>([]);
  const [interactionPoint, setInteractionPoint] = useState<THREE.Vector3 | null>(null);
  const [mode, setMode] = useState<'idle' | 'interaction' | 'flow' | 'climax'>('idle');
  const [intensity, setIntensity] = useState(0);
  const [isDisplayMode, setIsDisplayMode] = useState(false);
  const intensityRef = useRef(0);
  const requestRef = useRef<number>(null);

  useEffect(() => {
    // Check for display mode URL parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get('display') === 'true' || params.get('mode') === 'display') {
      setIsDisplayMode(true);
    }
  }, []);

  // Animation frame for audio visualizer data and intensity decay
  const animate = useCallback(() => {
    setAudioData(getAudioData());
    
    // Decay intensity - slightly slower decay to allow building up color
    intensityRef.current = Math.max(0, intensityRef.current - 0.012);
    setIntensity(intensityRef.current);

    requestRef.current = requestAnimationFrame(animate);
  }, [getAudioData]);

  useEffect(() => {
    if (isStarted || true) { // Always run for intensity tracking on splash
      requestRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isStarted, animate]);

  const handleEmitFlow = (text: string) => {
    setFlowText(text);
    setMode('flow');
    // Mimic "diffusion" to nodes
    setActiveNodes(["node_1", "node_2", "node_3", "node_4"]);
    setTimeout(() => {
      setFlowText(undefined);
      setActiveNodes([]);
      setMode('idle');
    }, 4000);

    // Increase evolution and intensity
    setMusicEvolution(Math.min(1, evolution + 0.1));
    intensityRef.current = Math.min(1, intensityRef.current + 0.3);
  };

  const handleInteraction = (point: THREE.Vector3 | null, isInteracting: boolean) => {
    setInteractionPoint(point);
    setMode(isInteracting ? 'interaction' : 'idle');
    if (isInteracting) {
      triggerNote("C3");
      intensityRef.current = Math.min(1, intensityRef.current + 0.05);
    }
  };

  const handleNodeTrigger = (id: string) => {
    const notes = ["C4", "Eb4", "F4", "G4", "Bb4"];
    triggerNote(notes[Math.floor(Math.random() * notes.length)]);
    setMusicEvolution(Math.min(1, evolution + 0.01));
    intensityRef.current = Math.min(1, intensityRef.current + 0.1);
  };

  const handleSplashPointerDown = async (e: React.PointerEvent) => {
    if (!isStarted) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const clientX = e.clientX;
      const clientY = e.clientY;

      await Tone.start();
      const notes = ["C2", "G2", "C3", "E3", "G3", "A3", "C4", "E4"];
      triggerNote(notes[Math.floor(Math.random() * notes.length)]);
      
      const point = new THREE.Vector3(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
        0
      ).multiplyScalar(14);
      
      setInteractionPoint(point);
      setMode('interaction');

      // Boost intensity on click - more aggressive
    intensityRef.current = Math.min(1, intensityRef.current + 0.25);
    }
  };

  const handleSplashPointerMove = (e: React.PointerEvent) => {
    if (!isStarted && mode === 'interaction' && e.currentTarget) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const point = new THREE.Vector3(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
        0
      ).multiplyScalar(14);
      setInteractionPoint(point);
    }
  };

  const handleSplashPointerUp = () => {
    if (!isStarted) {
      // Delay clearing to let the ripple travel a bit
      setTimeout(() => {
        setInteractionPoint(null);
        setMode('idle');
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#02040a] text-white flex flex-col font-sans select-none overflow-hidden">

      <AnimatePresence>
        {!isStarted && !isDisplayMode && (
          <motion.div
            key="splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={handleSplashPointerDown}
            onPointerMove={handleSplashPointerMove}
            onPointerUp={handleSplashPointerUp}
            className="fixed inset-0 z-[100] bg-[#02040a] flex flex-col items-center justify-center p-6 text-center cursor-pointer"
          >
            {/* Entry Screen Background */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
               <Canvas camera={{ position: [0, 0, 15], fov: 60 }} dpr={[1, 2]} gl={{ antialias: false, alpha: true }}>
                <ambientLight intensity={0.5} />
                <ParticleScene 
                  audioData={audioData} 
                  interactionPoint={interactionPoint} 
                  mode={mode} 
                  intensity={intensity}
                  isStarted={isStarted}
                />
                <EffectComposer>
                  <Bloom intensity={1.5 + intensity * 3} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
                </EffectComposer>
              </Canvas>
            </div>

            <motion.div
              animate={{ 
                scale: [1, 1.05, 1],
                boxShadow: ["0 0 0px rgba(34,211,238,0)", "0 0 40px rgba(34,211,238,0.2)", "0 0 0px rgba(34,211,238,0)"]
              }}
              transition={{ repeat: Infinity, duration: 4 }}
              className="relative z-10 w-[150px] h-[150px] rounded-full border border-cyan-500/30 flex items-center justify-center mb-8 bg-cyan-950/20 backdrop-blur-xl"
            >
              <Music size={40} className="text-cyan-400" />
            </motion.div>
            <h1 className="relative z-10 text-[41px] font-light tracking-[0.5em] mb-4 uppercase ml-[12px]">World Core</h1>
            <h2 className="relative z-10 text-2xl font-light tracking-[0.3em] mb-8 text-cyan-400/80 ml-0 mt-[-15px]">世界核心</h2>
            <p className="relative z-10 text-white/30 font-mono text-[10px] mb-12 max-w-xs uppercase tracking-[0.3em] leading-loose">
              Emotional Processing Interface Stage_01<br/>
              情感处理界面 第一阶段
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                startAudio();
              }}
              className="relative z-10 group px-16 py-4 border border-cyan-500/30 text-cyan-400 font-mono text-xs uppercase tracking-[0.4em] hover:bg-cyan-500/10 transition-all rounded mt-[-9px]"
            >
              <span className="relative z-10">Initialize System / 系统初始化</span>
              <div className="absolute inset-0 bg-cyan-400 opacity-0 group-hover:opacity-5 transition-opacity blur-2xl" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Application Layout (Only visible if isStarted is true) */}
      {isStarted && (
        <>
          {/* Main App Background */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-[#02040a]">
            <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-cyan-900/10 rounded-full blur-[120px]"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-indigo-900/10 rounded-full blur-[120px]"></div>
            
            <Canvas camera={{ position: [0, 0, 15], fov: 60 }} dpr={[1, 2]} gl={{ antialias: false, alpha: true }}>
              <ambientLight intensity={0.5} />
              <ParticleScene 
                audioData={audioData} 
                interactionPoint={interactionPoint} 
                mode={evolution > 0.8 ? 'climax' : mode} 
                intensity={intensity}
                isStarted={isStarted}
              />
              <EffectComposer>
                <Bloom intensity={1.5 + intensity * 2} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
              </EffectComposer>
            </Canvas>
          </div>
          {!isDisplayMode && (
            <>
              <header className="relative z-20 flex justify-between items-center px-10 py-6 border-b border-white/5 backdrop-blur-md">
                <div className="flex items-center gap-4">
                  <div className="w-2.5 h-2.5 bg-cyan-500 rounded-full shadow-[0_0_10px_#22d3ee] animate-pulse"></div>
                  <div>
                    <p className="text-[10px] tracking-widest text-cyan-400 font-mono uppercase">System.Core_Status / 核心状态</p>
                    <p className="text-[11px] font-medium opacity-60 uppercase tracking-tighter">Processor : Active / 处理单元：活跃</p>
                  </div>
                </div>
                <div className="flex items-center gap-12">
                  <button 
                    onClick={stopAudio}
                    className="flex flex-col items-center gap-1 group transition-colors"
                  >
                    <div className="p-2 rounded-full border border-white/10 bg-white/5 group-hover:border-white/30 group-hover:bg-white/10 transition-all">
                      <Home size={14} className="text-white/60 group-hover:text-white" />
                    </div>
                    <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 group-hover:opacity-80 transition-opacity">
                      Home / 返回主页
                    </span>
                  </button>

                  <button 
                    onClick={toggleMute}
                    className="flex flex-col items-center gap-1 group transition-colors"
                  >
                    <div className={`p-2 rounded-full border transition-all ${isMuted ? 'border-red-500/30 bg-red-500/10' : 'border-cyan-500/30 bg-cyan-500/10'}`}>
                      <Music size={14} className={isMuted ? 'text-red-400' : 'text-cyan-400'} />
                    </div>
                    <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 group-hover:opacity-80 transition-opacity">
                      {isMuted ? 'Music: Off / 音乐：关' : 'Music: On / 音乐：开'}
                    </span>
                  </button>
                  <div className="text-right">
                    <p className="text-[10px] tracking-widest text-indigo-400 font-mono uppercase">Evolution_Stage / 演进阶段</p>
                    <p className="text-[11px] font-medium opacity-60 uppercase tracking-tighter">{(evolution * 100).toFixed(1)}% / Stage_Synced / 阶段同步</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] tracking-widest text-orange-400 font-mono uppercase">Synapse_Sync / 突触同步</p>
                    <p className="text-[11px] font-medium opacity-60 uppercase tracking-tighter">Nodes / 节点: {activeNodes.length > 0 ? '08' : '00'}</p>
                  </div>
                </div>
              </header>

              <div className="flex-1 flex p-6 relative z-10">
                {/* Central Main Screen */}
                <div className="flex-1 relative flex flex-col items-center justify-center">
                  <div className="w-full h-full relative">
                    <MainProcessor 
                      audioData={audioData} 
                      onInteraction={handleInteraction} 
                      onEmitFlow={handleEmitFlow}
                      evolution={evolution}
                    />
                  </div>
                </div>
              </div>

              <footer className="relative z-20 px-10 py-6 grid grid-cols-4 gap-8 border-t border-white/10 bg-black/40 backdrop-blur-lg">
                <div className="space-y-3">
                  <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Sub_Screen_01 // Ambient / 环境</p>
                  <div className="h-10 border border-white/5 bg-white/5 rounded flex items-end px-2 pb-1.5 gap-[4px] overflow-hidden">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const sampleIdx = Math.floor((i / 12) * audioData.length * 0.2);
                      const value = (audioData[sampleIdx] || 0) * 100;
                      return (
                        <motion.div 
                          key={i}
                          animate={{ 
                            height: `${Math.max(10, value + 5)}%`,
                            backgroundColor: value > 50 ? 'rgba(34, 211, 238, 0.6)' : 'rgba(34, 211, 238, 0.2)'
                          }}
                          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                          className="flex-1 min-w-[2px]" 
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Sub_Screen_02 // Pulse / 脉冲</p>
                  <div className="h-10 border border-white/5 bg-white/5 rounded flex items-center justify-center overflow-hidden">
                    <motion.div 
                      animate={{ 
                        scale: [1, 1 + intensity * 0.5, 1],
                        opacity: [0.2, 0.2 + intensity * 0.6, 0.2],
                        borderWidth: [1, 2, 1]
                      }}
                      transition={{ repeat: Infinity, duration: 2 - intensity * 1.5, ease: "easeInOut" }}
                      className="w-8 h-8 border border-indigo-500/60 rounded-full flex items-center justify-center" 
                    >
                      <div className="w-1 h-1 bg-indigo-400 rounded-full animate-ping" />
                    </motion.div>
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Sub_Screen_03 // Buffer / 缓冲</p>
                  <div className="h-10 border border-white/5 bg-white/5 rounded overflow-hidden flex items-center relative">
                    <motion.div 
                      animate={{ 
                        x: ['-140%', '140%'],
                        opacity: [0.1, 0.3, 0.1]
                      }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                      className="h-full w-32 bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent skew-x-12" 
                    />
                    <motion.div 
                      animate={{ opacity: [0.1, 0.4, 0.1] }}
                      transition={{ repeat: Infinity, duration: 0.1 }}
                      className="absolute inset-0 bg-white/5 pointer-events-none"
                    />
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] font-mono text-white/30 tracking-[0.5em] whitespace-nowrap">
                      DATA_STREAM_POLLING / 数据流轮询
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Synaptic_Evolution / 突触演进</p>
                  <div className="flex justify-between items-baseline">
                    <motion.span 
                      animate={{ opacity: [0.8, 1, 0.8], x: [0, intensity * 2, 0] }}
                      transition={{ repeat: Infinity, duration: 0.5 }}
                      className="text-2xl font-light tracking-tighter text-white/90 font-mono"
                    >
                      {evolution.toFixed(4)}
                    </motion.span>
                    <span className={`text-[10px] font-mono ${evolution > 0.8 ? 'text-orange-400' : 'text-cyan-400/60'} animate-pulse`}>
                      {evolution > 0.8 ? 'PHASE_CRITICAL / 关键相位' : 'GROWTH_ACTIVE / 生长活跃'}
                    </span>
                  </div>
                </div>
              </footer>
            </>
          )}
        </>
      )}
    </div>
  );
}
