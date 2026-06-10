import type { RenderParams } from "./types"
import { MODE_INDEX } from "../state/hash"
import { spanMantExp } from "../util/renderMath"
import { RefOrbitTexture } from "./refOrbitTexture"
import blitFrag from "./blit.frag?raw"
import directFrag from "./mandelbrot.frag?raw"
import perturbFrag from "./mandelbrot.perturb.frag?raw"
import paletteSource from "./palette.glsl?raw"
import vertSource from "./mandelbrot.vert?raw"

/** Splice the shared palette chunk into a fragment shader (poor man's #include). */
function expandIncludes(src: string): string {
  return src.replace("//#include palette.glsl", paletteSource)
}

const ORBIT_UNIT = 0
const BLIT_UNIT = 1

type DirectUniforms = {
  uResolution: WebGLUniformLocation
  uCenter: WebGLUniformLocation
  uSpanX: WebGLUniformLocation
  uMaxIter: WebGLUniformLocation
  uHue: WebGLUniformLocation
  uSat: WebGLUniformLocation
  uVal: WebGLUniformLocation
  uScale: WebGLUniformLocation
  uOffset: WebGLUniformLocation
  uRelief: WebGLUniformLocation
  uSmooth: WebGLUniformLocation
  uMode: WebGLUniformLocation
}

type PerturbUniforms = {
  uResolution: WebGLUniformLocation
  uSpanMant: WebGLUniformLocation
  uSpanExp: WebGLUniformLocation
  uPixelBias: WebGLUniformLocation
  uMaxIter: WebGLUniformLocation
  uRefOrbit: WebGLUniformLocation
  uRefW: WebGLUniformLocation
  uMaxRefIter: WebGLUniformLocation
  uHue: WebGLUniformLocation
  uSat: WebGLUniformLocation
  uVal: WebGLUniformLocation
  uScale: WebGLUniformLocation
  uOffset: WebGLUniformLocation
  uRelief: WebGLUniformLocation
  uSmooth: WebGLUniformLocation
  uMode: WebGLUniformLocation
}

type BlitUniforms = {
  uResolution: WebGLUniformLocation
  uTex: WebGLUniformLocation
  uTexSize: WebGLUniformLocation
  uScaleRatio: WebGLUniformLocation
  uOffset: WebGLUniformLocation
}

/** Offscreen color target the deep tier renders into (double-buffered). */
type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

export class GLRenderer {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private directProgram: WebGLProgram
  private perturbProgram: WebGLProgram
  private blitProgram: WebGLProgram
  private directUniforms: DirectUniforms
  private perturbUniforms: PerturbUniforms
  private blitUniforms: BlitUniforms
  private orbit: RefOrbitTexture
  private hasOrbit = false
  // Deep-tier job state: strips render into `back`; on completion the caller
  // swaps it to `front`, which blitFront() presents. `jobFence` gates strip
  // submission so at most ~one strip of GPU work is ever queued — that bound
  // is what keeps the canvas (and the main thread) responsive during slow
  // perturbation renders.
  private front: Target
  private back: Target
  private jobFence: WebGLSync | null = null

  constructor(canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer: the deep tier presents only on frames where a
    // strip job completes (the direct tier redraws every frame), so the canvas
    // must retain its buffer or captures/composites between presents go black.
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error("WebGL2 not supported")
    this.gl = gl
    // RG32F is sampleable in core WebGL2; request this anyway for broad support.
    gl.getExtension("EXT_color_buffer_float")

    const vs = compile(gl, gl.VERTEX_SHADER, vertSource)
    this.directProgram = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, expandIncludes(directFrag)))
    this.perturbProgram = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, expandIncludes(perturbFrag)))
    this.blitProgram = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, blitFrag))
    gl.deleteShader(vs)

    this.directUniforms = mapUniforms(gl, this.directProgram, [
      "uResolution", "uCenter", "uSpanX", "uMaxIter",
      "uHue", "uSat", "uVal", "uScale", "uOffset", "uRelief", "uSmooth", "uMode",
    ]) as unknown as DirectUniforms
    this.perturbUniforms = mapUniforms(gl, this.perturbProgram, [
      "uResolution", "uSpanMant", "uSpanExp", "uPixelBias", "uMaxIter",
      "uRefOrbit", "uRefW", "uMaxRefIter",
      "uHue", "uSat", "uVal", "uScale", "uOffset", "uRelief", "uSmooth", "uMode",
    ]) as unknown as PerturbUniforms
    this.blitUniforms = mapUniforms(gl, this.blitProgram, [
      "uResolution", "uTex", "uTexSize", "uScaleRatio", "uOffset",
    ]) as unknown as BlitUniforms

    const vao = gl.createVertexArray()
    if (!vao) throw new Error("Failed to create VAO")
    this.vao = vao
    this.orbit = new RefOrbitTexture(gl)
    this.front = makeTarget(gl)
    this.back = makeTarget(gl)
  }

  resize(width: number, height: number): void {
    const { gl } = this
    if (gl.canvas.width !== width) gl.canvas.width = width
    if (gl.canvas.height !== height) gl.canvas.height = height
    gl.viewport(0, 0, width, height)
  }

  /** Upload a freshly computed reference orbit for the Tier C shader to consume. */
  setOrbit(orbit: Float32Array, maxRefIter: number): void {
    this.orbit.update(orbit, maxRefIter)
    this.hasOrbit = true
  }

  hasOrbitData(): boolean {
    return this.hasOrbit
  }

  /** Draw the shallow (direct float32) tier straight to the canvas. */
  render(params: RenderParams): void {
    const { gl, directUniforms: u } = this
    const p = params
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.directProgram)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(u.uResolution, p.width, p.height)
    gl.uniform2f(u.uCenter, p.cx, p.cy)
    gl.uniform1f(u.uSpanX, p.spanX)
    gl.uniform1i(u.uMaxIter, p.iterations)
    this.setPalette(u, p)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /**
   * True when the GPU has drained the last submitted strip (or none is
   * pending) — i.e. it is safe to submit more deep-tier work without queueing.
   */
  jobReady(): boolean {
    const { gl } = this
    if (!this.jobFence) return true
    const s = gl.clientWaitSync(this.jobFence, 0, 0)
    if (s === gl.TIMEOUT_EXPIRED) return false
    gl.deleteSync(this.jobFence) // signaled (or wait failed — don't deadlock)
    this.jobFence = null
    return true
  }

  /** Size (reallocating if needed) and clear the back target for a new job. */
  beginPerturbJob(w: number, h: number): void {
    const { gl } = this
    const t = this.back
    if (t.w !== w || t.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      t.w = w
      t.h = h
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Render `rows` scanlines starting at `y0` into the back target, then fence. */
  renderPerturbStrip(p: RenderParams, y0: number, rows: number): void {
    const { gl, perturbUniforms: u } = this
    const t = this.back
    const { mant, exp } = spanMantExp(p.spanX)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, t.w, t.h)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(0, y0, t.w, rows)
    gl.useProgram(this.perturbProgram)
    gl.bindVertexArray(this.vao)
    this.orbit.bind(ORBIT_UNIT)
    gl.uniform1i(u.uRefOrbit, ORBIT_UNIT)
    gl.uniform1i(u.uRefW, this.orbit.width)
    gl.uniform1i(u.uMaxRefIter, this.orbit.maxRefIter)
    gl.uniform2f(u.uResolution, t.w, t.h)
    gl.uniform1f(u.uSpanMant, mant)
    gl.uniform1f(u.uSpanExp, exp)
    gl.uniform2f(u.uPixelBias, p.biasX ?? 0, p.biasY ?? 0)
    gl.uniform1i(u.uMaxIter, p.iterations)
    this.setPalette(u, p)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.disable(gl.SCISSOR_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.jobFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush() // fences only signal once the command stream is flushed
  }

  /** Promote the completed back target to front (call once all strips drained). */
  finishPerturbJob(): void {
    const t = this.front
    this.front = this.back
    this.back = t
  }

  /**
   * Present the front target on the canvas, remapped from the viewport it was
   * rendered at to the live one. Trivially cheap — safe to call every frame.
   */
  blitFront(width: number, height: number, scaleRatio: number, offX: number, offY: number): void {
    const { gl, blitUniforms: u } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.blitProgram)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0 + BLIT_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, this.front.tex)
    gl.uniform1i(u.uTex, BLIT_UNIT)
    gl.uniform2f(u.uTexSize, this.front.w, this.front.h)
    gl.uniform2f(u.uResolution, width, height)
    gl.uniform1f(u.uScaleRatio, scaleRatio)
    gl.uniform2f(u.uOffset, offX, offY)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private setPalette(u: DirectUniforms | PerturbUniforms, p: RenderParams): void {
    const { gl } = this
    gl.uniform1f(u.uHue, p.palette.hue)
    gl.uniform1f(u.uSat, p.palette.sat)
    gl.uniform1f(u.uVal, p.palette.val)
    gl.uniform1f(u.uScale, p.palette.scale)
    gl.uniform1f(u.uOffset, p.palette.offset)
    gl.uniform1f(u.uRelief, p.palette.relief)
    gl.uniform1i(u.uSmooth, p.palette.smooth ? 1 : 0)
    gl.uniform1i(u.uMode, MODE_INDEX[p.palette.mode])
  }

  dispose(): void {
    const { gl } = this
    if (this.jobFence) gl.deleteSync(this.jobFence)
    for (const t of [this.front, this.back]) {
      gl.deleteFramebuffer(t.fbo)
      gl.deleteTexture(t.tex)
    }
    gl.deleteProgram(this.directProgram)
    gl.deleteProgram(this.perturbProgram)
    gl.deleteProgram(this.blitProgram)
    gl.deleteVertexArray(this.vao)
    this.orbit.dispose()
  }
}

function makeTarget(gl: WebGL2RenderingContext): Target {
  const tex = gl.createTexture()
  const fbo = gl.createFramebuffer()
  if (!tex || !fbo) throw new Error("Failed to create offscreen target")
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { tex, fbo, w: 1, h: 1 }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("Failed to create shader")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)"
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed:\n${log}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error("Failed to create program")
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.detachShader(program, vs)
  gl.detachShader(program, fs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)"
    gl.deleteProgram(program)
    throw new Error(`Program link failed:\n${log}`)
  }
  return program
}

function mapUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: string[],
): Record<string, WebGLUniformLocation> {
  const out: Record<string, WebGLUniformLocation> = {}
  for (const name of names) {
    const loc = gl.getUniformLocation(program, name)
    if (!loc) throw new Error(`Uniform '${name}' not found (optimized out?)`)
    out[name] = loc
  }
  return out
}
