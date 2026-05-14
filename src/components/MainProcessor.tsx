import React, { useState, useCallback, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { ParticleScene } from './Visuals/ParticleScene';
import { motion, AnimatePresence } from 'motion/react';
import { Send, MousePointer2 } from 'lucide-react';

interface MainProcessorProps {
  audioData: Float32Array;
  onInteraction: (point: THREE.Vector3 | null, isInteracting: boolean) => void;
  onEmitFlow: (text: string) => void;
  evolution: number;
}

const PROMPTS = [
  "你想留下什么？ (What do you want to leave behind?)",
  "你最近学到了什么？ (What did you learn recently?)",
  "哪些问题尚未解决？ (What questions are still unsolved?)"
];

export const MainProcessor: React.FC<MainProcessorProps> = ({ audioData, onInteraction, onEmitFlow, evolution }) => {
  const [inputText, setInputText] = useState("");
  const [currentPromptIdx, setCurrentPromptIdx] = useState(0);
  const [showInput, setShowInput] = useState(true);

  const handlePointerDown = (e: any) => {
    const point = new THREE.Vector3(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
      0
    ).multiplyScalar(8);
    onInteraction(point, true);
  };

  const handlePointerUp = () => {
    onInteraction(null, false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    
    onEmitFlow(inputText);
    setShowInput(false);
    
    setTimeout(() => {
      setInputText("");
      setCurrentPromptIdx((prev) => (prev + 1) % PROMPTS.length);
      setShowInput(true);
    }, 4000);
  };

  return (
    <div className="relative w-full h-full overflow-hidden cursor-crosshair">
      {/* Stage Elements (Holographic Rings Decoration) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 transition-opacity duration-1000">
        <div className="absolute w-[600px] h-[600px] border border-cyan-500/20 rounded-full animate-[spin_60s_linear_infinite]" />
        <div className="absolute w-[500px] h-[500px] border border-indigo-500/30 rounded-full border-dashed animate-[spin_40s_linear_infinite_reverse]" />
        <div className="absolute w-[400px] h-[400px] border-2 border-white/5 rounded-full" />
      </div>

      {/* Interaction Surface */}
      <div 
        className="absolute inset-0 z-10 flex flex-col items-center justify-center p-8 pointer-events-auto"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={(e) => {
          // Continuous mapping if needed
        }}
      >
        <AnimatePresence mode="wait">
          {showInput && (
            <motion.div
              key="input_box"
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className="w-[420px] pointer-events-auto shadow-2xl relative z-30"
            >
              <div className="bg-black/60 backdrop-blur-2xl p-10 pl-10 border border-white/10 rounded-[32px] shadow-[0_0_80px_rgba(0,0,0,0.5)] w-[424px] h-[273.833px] -mt-[100px] mb-[50px]">
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest opacity-80">Dialogue_Session / 对话会话 // {currentPromptIdx + 1}</span>
                    <div className="h-px flex-1 bg-white/10"></div>
                  </div>
                  <h2 className="text-3xl font-light italic tracking-tight text-white leading-tight">
                    {PROMPTS[currentPromptIdx].split('(')[0]}
                  </h2>
                  <p className="text-[10px] text-white/30 font-mono mt-4 uppercase tracking-[0.2em]">
                    {PROMPTS[currentPromptIdx].split('(')[1]?.replace(')', '') || "Input consciousness stream..."}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="relative group">
                  <div className="h-14 bg-white/5 border-b border-cyan-500/50 flex items-center pl-[15px] pr-4 transition-all focus-within:bg-white/10 w-[346.667px] mt-[19px] mb-[15px]">
                    <span className="text-cyan-400 font-mono mr-3 text-lg">&gt;</span>
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Enter stream... / 输入意识流..."
                      className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder:text-white/20 font-light italic"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    className="absolute -bottom-6 right-0 pl-[16px] pr-4 pt-[4px] pb-0 bg-cyan-500/10 border border-cyan-500/30 rounded text-[9px] uppercase tracking-widest text-cyan-400 hover:bg-cyan-500/20 transition-all font-mono"
                  >
                    Confirm_Transmission / 确认传输
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Decorative Label */}
      <div className="absolute top-20 right-10 text-right pointer-events-none opacity-40">
        <p className="text-[10px] font-mono text-cyan-400 uppercase tracking-[0.4em] mb-1">Processing_Buffer / 处理缓冲</p>
        <div className="flex justify-end gap-1">
          {[1,2,3,4,5].map(i => <div key={i} className={`w-0.5 h-3 ${i <= 3 ? 'bg-cyan-500' : 'bg-white/10'}`} />)}
        </div>
      </div>
    </div>
  );
};
