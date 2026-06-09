import type { RenderParams } from "./types"
import { spanMantExp } from "../util/renderMath"
import { RefOrbitTexture } from "./refOrbitTexture"
import directFrag from "./mandelbrot.frag?raw"
import perturbFrag from "./mandelbrot.perturb.frag?raw"
import vertSource from "./mandelbrot.vert?raw"

const ORBIT_UNIT = 0

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
  uSmooth: WebGLUniformLocation
  uMode: WebGLUniformLocation
}

export class GLRenderer {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private directProgram: WebGLProgram
  private perturbProgram: WebGLProgram
  private directUniforms: DirectUniforms
  private perturbUniforms: PerturbUniforms
  private orbit: RefOrbitTexture
  private hasOrbit = false

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error("WebGL2 not supported")
    this.gl = gl
    // RG32F is sampleable in core WebGL2; request this anyway for broad support.
    gl.getExtension("EXT_color_buffer_float")

    const vs = compile(gl, gl.VERTEX_SHADER, vertSource)
    this.directProgram = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, directFrag))
    this.perturbProgram = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, perturbFrag))
    gl.deleteShader(vs)

    this.directUniforms = mapUniforms(gl, this.directProgram, [
      "uResolution", "uCenter", "uSpanX", "uMaxIter",
      "uHue", "uSat", "uVal", "uScale", "uOffset", "uSmooth", "uMode",
    ]) as unknown as DirectUniforms
    this.perturbUniforms = mapUniforms(gl, this.perturbProgram, [
      "uResolution", "uSpanMant", "uSpanExp", "uPixelBias", "uMaxIter",
      "uRefOrbit", "uRefW", "uMaxRefIter",
      "uHue", "uSat", "uVal", "uScale", "uOffset", "uSmooth", "uMode",
    ]) as unknown as PerturbUniforms

    const vao = gl.createVertexArray()
    if (!vao) throw new Error("Failed to create VAO")
    this.vao = vao
    this.orbit = new RefOrbitTexture(gl)
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

  /** Returns false if it could not draw (e.g. perturb tier with no orbit yet). */
  render(params: RenderParams): boolean {
    if (params.tier === "perturb") {
      if (!this.hasOrbit) return false
      this.renderPerturb(params)
    } else {
      this.renderDirect(params)
    }
    return true
  }

  private renderDirect(p: RenderParams): void {
    const { gl, directUniforms: u } = this
    gl.useProgram(this.directProgram)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(u.uResolution, p.width, p.height)
    gl.uniform2f(u.uCenter, p.cx, p.cy)
    gl.uniform1f(u.uSpanX, p.spanX)
    gl.uniform1i(u.uMaxIter, p.iterations)
    this.setPalette(u, p)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private renderPerturb(p: RenderParams): void {
    const { gl, perturbUniforms: u } = this
    const { mant, exp } = spanMantExp(p.spanX)
    gl.useProgram(this.perturbProgram)
    gl.bindVertexArray(this.vao)
    this.orbit.bind(ORBIT_UNIT)
    gl.uniform1i(u.uRefOrbit, ORBIT_UNIT)
    gl.uniform1i(u.uRefW, this.orbit.width)
    gl.uniform1i(u.uMaxRefIter, this.orbit.maxRefIter)
    gl.uniform2f(u.uResolution, p.width, p.height)
    gl.uniform1f(u.uSpanMant, mant)
    gl.uniform1f(u.uSpanExp, exp)
    gl.uniform2f(u.uPixelBias, p.biasX ?? 0, p.biasY ?? 0)
    gl.uniform1i(u.uMaxIter, p.iterations)
    this.setPalette(u, p)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private setPalette(u: DirectUniforms | PerturbUniforms, p: RenderParams): void {
    const { gl } = this
    gl.uniform1f(u.uHue, p.palette.hue)
    gl.uniform1f(u.uSat, p.palette.sat)
    gl.uniform1f(u.uVal, p.palette.val)
    gl.uniform1f(u.uScale, p.palette.scale)
    gl.uniform1f(u.uOffset, p.palette.offset)
    gl.uniform1i(u.uSmooth, p.palette.smooth ? 1 : 0)
    gl.uniform1i(u.uMode, p.palette.mode === "iq" ? 1 : 0)
  }

  dispose(): void {
    const { gl } = this
    gl.deleteProgram(this.directProgram)
    gl.deleteProgram(this.perturbProgram)
    gl.deleteVertexArray(this.vao)
    this.orbit.dispose()
  }
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
