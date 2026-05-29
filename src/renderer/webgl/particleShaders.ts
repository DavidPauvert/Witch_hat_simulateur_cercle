export const PARTICLE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_quad;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_radius;

uniform vec2 u_resolution;

out vec4 v_color;
out vec2 v_quad;

void main() {
    // 1. Transform from canvas space [0, resolution] to centered space [-1, 1]
    // where Y=0 is the transform origin (64% of height)
    float originY = u_resolution.y * 0.64;
    vec3 centered = a_position;
    centered.y -= originY;

    // 2. Apply CSS-like rotation and perspective
    // CSS: rotateX(62deg)
    float angle = radians(62.0);
    float cosA = cos(angle);
    float sinA = sin(angle);
    
    // Rotate around X axis (affecting Y and Z)
    float rotatedY = centered.y * cosA - centered.z * sinA;
    float rotatedZ = centered.y * sinA + centered.z * cosA;
    
    // 3. Apply perspective: 900px
    // CSS perspective: 900px.
    float perspective = 900.0;
    float w = 1.0 + rotatedZ / perspective;
    
    // 4. Final screen position
    vec2 screenPos = vec2(centered.x, rotatedY);
    
    // Divide by perspective factor
    screenPos /= w;
    
    // Shift Y back from origin
    screenPos.y += originY;

    // 5. Quad extrusion for the particle sprite
    // Multiply by radius and perspective factor to keep size stable in 3D
    vec2 offset = a_quad * a_radius / w;
    vec2 finalPos = screenPos + offset;

    // 6. Project to WebGL NDC [-1, 1]
    vec2 ndc = (finalPos / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);

    v_color = a_color;
    v_quad = a_quad;
}
`;

export const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
in vec2 v_quad;

out vec4 outColor;

void main() {
    float dist = length(v_quad);
    if (dist > 1.0) {
        discard;
    }

    // High performance procedural glow
    // Falloff roughly matches 2D radial gradient
    float alpha = (1.0 - dist) * (1.0 - dist);
    
    outColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;
