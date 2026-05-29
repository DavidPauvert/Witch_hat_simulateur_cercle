import { PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER } from './particleShaders';

export interface WebGLParticle {
    x: number;
    y: number;
    z: number;
    radius: number;
    r: number;
    g: number;
    b: number;
    a: number;
}

export class WebGLRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;
    private vao: WebGLVertexArrayObject;
    private particleBuffer: WebGLBuffer;
    private maxParticles: number = 2000;
    
    // 9 floats per particle: x, y, z, radius, r, g, b, a
    private particleData: Float32Array;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: true,
            premultipliedAlpha: false,
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        this.gl = gl;
        this.program = this.createProgram(PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER);
        this.particleData = new Float32Array(this.maxParticles * 8);
        
        this.vao = gl.createVertexArray()!;
        gl.bindVertexArray(this.vao);

        // Quad geometry (static)
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        const quadPoints = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1,
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, quadPoints, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1); // a_quad
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        // Particle data (dynamic)
        this.particleBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);

        // a_position (vec3)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 8 * 4, 0);
        gl.vertexAttribDivisor(0, 1);

        // a_radius (float)
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 8 * 4, 3 * 4);
        gl.vertexAttribDivisor(3, 1);

        // a_color (vec4)
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 8 * 4, 4 * 4);
        gl.vertexAttribDivisor(2, 1);

        gl.bindVertexArray(null);
    }

    private createProgram(vsSource: string, fsSource: string): WebGLProgram {
        const gl = this.gl;
        const vs = this.loadShader(gl.VERTEX_SHADER, vsSource);
        const fs = this.loadShader(gl.FRAGMENT_SHADER, fsSource);

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('Linker error: ' + gl.getProgramInfoLog(program));
        }

        return program;
    }

    private loadShader(type: number, source: string): WebGLShader {
        const gl = this.gl;
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Compiler error: ' + info);
        }

        return shader;
    }

    render(particles: WebGLParticle[], width: number, height: number, compositeOperation: 'lighter' | 'source-over' = 'lighter') {
        const gl = this.gl;
        
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (particles.length === 0) return;

        const count = Math.min(particles.length, this.maxParticles);
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const idx = i * 8;
            this.particleData[idx + 0] = p.x;
            this.particleData[idx + 1] = p.y;
            this.particleData[idx + 2] = p.z;
            this.particleData[idx + 3] = p.radius;
            this.particleData[idx + 4] = p.r;
            this.particleData[idx + 5] = p.g;
            this.particleData[idx + 6] = p.b;
            this.particleData[idx + 7] = p.a;
        }

        gl.useProgram(this.program);
        gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), width, height);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData.subarray(0, count * 8));

        gl.enable(gl.BLEND);
        if (compositeOperation === 'lighter') {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        } else {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        gl.bindVertexArray(this.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        gl.bindVertexArray(null);
    }
}
