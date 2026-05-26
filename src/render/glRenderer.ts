import type { RenderParams } from "./types"
import dfMathSource from "./dfMath.glsl?raw"
import fragF32Source from "./mandelbrot.frag?raw"
import fragDFTemplate from "./mandelbrot_df.frag?raw"
import fragTFTemplate from "./mandelbrot_tf.frag?raw"
import tfMathSource from "./tfMath.glsl?raw"
import vertSource from "./mandelbrot.vert?raw"

import {
  type PrecisionTier,
  nextPrecisionTier,
  splitDF,
  splitTF,
} from "../util/renderMath"

type CommonUniforms = {
  uResolution: WebGLUniformLocation
  uMaxIter: WebGLUniformLocation
  uHue: WebGLUniformLocation
  uSat: WebGLUniformLocation
  uVal: WebGLUniformLocation
  uScale: WebGLUniformLocation
  uOffset: WebGLUniformLocation
}

type F32Uniforms = CommonUniforms & {
  uCenter: WebGLUniformLocation
  uSpanX: WebGLUniformLocation
}

type DFUniforms = CommonUniforms & {
  uCenterHi: WebGLUniformLocation
  uCenterLo: WebGLUniformLocation
  uSpanXHi: WebGLUniformLocation
  uSpanXLo: WebGLUniformLocation
}

type TFUniforms = CommonUniforms & {
  uCenterHi: WebGLUniformLocation
  uCenterMid: WebGLUniformLocation
  uCenterLo: WebGLUniformLocation
  uSpanXHi: WebGLUniformLocation
  uSpanXMid: WebGLUniformLocation
  uSpanXLo: WebGLUniformLocation
}

type TierBundle =
  | { tier: "f32"; program: WebGLProgram; uniforms: F32Uniforms }
  | { tier: "df"; program: WebGLProgram; uniforms: DFUniforms }
  | { tier: "tf"; program: WebGLProgram; uniforms: TFUniforms }

export class GLRenderer {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private bundles: { f32: TierBundle; df: TierBundle; tf: TierBundle }
  private tier: PrecisionTier = "f32"

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error("WebGL2 not supported")
    this.gl = gl

    const vs = compile(gl, gl.VERTEX_SHADER, vertSource)

    const f32Program = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, fragF32Source), false)
    const dfSource = fragDFTemplate.replace("// @INCLUDE_DF_MATH", dfMathSource)
    const dfProgram = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, dfSource), false)
    const tfSource = fragTFTemplate.replace("// @INCLUDE_TF_MATH", tfMathSource)
    const tfProgram = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, tfSource), true)

    this.bundles = {
      f32: { tier: "f32", program: f32Program, uniforms: locateF32(gl, f32Program) },
      df: { tier: "df", program: dfProgram, uniforms: locateDF(gl, dfProgram) },
      tf: { tier: "tf", program: tfProgram, uniforms: locateTF(gl, tfProgram) },
    }

    const vao = gl.createVertexArray()
    if (!vao) throw new Error("Failed to create VAO")
    this.vao = vao
  }

  resize(width: number, height: number): void {
    const { gl } = this
    if (gl.canvas.width !== width) gl.canvas.width = width
    if (gl.canvas.height !== height) gl.canvas.height = height
    gl.viewport(0, 0, width, height)
  }

  currentTier(): PrecisionTier {
    return this.tier
  }

  render(params: RenderParams): void {
    const { gl, vao } = this
    this.tier = nextPrecisionTier(this.tier, params.spanX)
    const bundle = this.bundles[this.tier]
    gl.useProgram(bundle.program)
    gl.bindVertexArray(vao)
    gl.uniform2f(bundle.uniforms.uResolution, params.width, params.height)
    gl.uniform1i(bundle.uniforms.uMaxIter, params.iterations)
    gl.uniform1f(bundle.uniforms.uHue, params.palette.hue)
    gl.uniform1f(bundle.uniforms.uSat, params.palette.sat)
    gl.uniform1f(bundle.uniforms.uVal, params.palette.val)
    gl.uniform1f(bundle.uniforms.uScale, params.palette.scale)
    gl.uniform1f(bundle.uniforms.uOffset, params.palette.offset)

    if (bundle.tier === "f32") {
      gl.uniform2f(bundle.uniforms.uCenter, params.cx, params.cy)
      gl.uniform1f(bundle.uniforms.uSpanX, params.spanX)
    } else if (bundle.tier === "df") {
      const [cxHi, cxLo] = splitDF(params.cx)
      const [cyHi, cyLo] = splitDF(params.cy)
      const [sxHi, sxLo] = splitDF(params.spanX)
      gl.uniform2f(bundle.uniforms.uCenterHi, cxHi, cyHi)
      gl.uniform2f(bundle.uniforms.uCenterLo, cxLo, cyLo)
      gl.uniform1f(bundle.uniforms.uSpanXHi, sxHi)
      gl.uniform1f(bundle.uniforms.uSpanXLo, sxLo)
    } else {
      const [cxHi, cxMid, cxLo] = splitTF(params.cx)
      const [cyHi, cyMid, cyLo] = splitTF(params.cy)
      const [sxHi, sxMid, sxLo] = splitTF(params.spanX)
      gl.uniform2f(bundle.uniforms.uCenterHi, cxHi, cyHi)
      gl.uniform2f(bundle.uniforms.uCenterMid, cxMid, cyMid)
      gl.uniform2f(bundle.uniforms.uCenterLo, cxLo, cyLo)
      gl.uniform1f(bundle.uniforms.uSpanXHi, sxHi)
      gl.uniform1f(bundle.uniforms.uSpanXMid, sxMid)
      gl.uniform1f(bundle.uniforms.uSpanXLo, sxLo)
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    const { gl } = this
    gl.deleteProgram(this.bundles.f32.program)
    gl.deleteProgram(this.bundles.df.program)
    gl.deleteProgram(this.bundles.tf.program)
    gl.deleteVertexArray(this.vao)
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

// `deleteVS` should only be true on the final link — the vertex shader is
// reused across all three programs.
function link(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
  deleteVS: boolean,
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error("Failed to create program")
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.detachShader(program, vs)
  gl.detachShader(program, fs)
  gl.deleteShader(fs)
  if (deleteVS) gl.deleteShader(vs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)"
    gl.deleteProgram(program)
    throw new Error(`Program link failed:\n${log}`)
  }
  return program
}

function getUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name)
  if (!loc) throw new Error(`Uniform '${name}' not found (probably optimized out)`)
  return loc
}

function locateCommon(gl: WebGL2RenderingContext, program: WebGLProgram): CommonUniforms {
  return {
    uResolution: getUniform(gl, program, "uResolution"),
    uMaxIter: getUniform(gl, program, "uMaxIter"),
    uHue: getUniform(gl, program, "uHue"),
    uSat: getUniform(gl, program, "uSat"),
    uVal: getUniform(gl, program, "uVal"),
    uScale: getUniform(gl, program, "uScale"),
    uOffset: getUniform(gl, program, "uOffset"),
  }
}

function locateF32(gl: WebGL2RenderingContext, program: WebGLProgram): F32Uniforms {
  return {
    ...locateCommon(gl, program),
    uCenter: getUniform(gl, program, "uCenter"),
    uSpanX: getUniform(gl, program, "uSpanX"),
  }
}

function locateDF(gl: WebGL2RenderingContext, program: WebGLProgram): DFUniforms {
  return {
    ...locateCommon(gl, program),
    uCenterHi: getUniform(gl, program, "uCenterHi"),
    uCenterLo: getUniform(gl, program, "uCenterLo"),
    uSpanXHi: getUniform(gl, program, "uSpanXHi"),
    uSpanXLo: getUniform(gl, program, "uSpanXLo"),
  }
}

function locateTF(gl: WebGL2RenderingContext, program: WebGLProgram): TFUniforms {
  return {
    ...locateCommon(gl, program),
    uCenterHi: getUniform(gl, program, "uCenterHi"),
    uCenterMid: getUniform(gl, program, "uCenterMid"),
    uCenterLo: getUniform(gl, program, "uCenterLo"),
    uSpanXHi: getUniform(gl, program, "uSpanXHi"),
    uSpanXMid: getUniform(gl, program, "uSpanXMid"),
    uSpanXLo: getUniform(gl, program, "uSpanXLo"),
  }
}
