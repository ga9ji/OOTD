// A transparent layer of drifting camp embers and late-afternoon light.
uniform float clock;
uniform float aspect;
varying vec2 coord;

float hash(vec2 cell) {
  return fract(sin(dot(cell, vec2(41.3, 73.9))) * 4375.54);
}

void main() {
  vec2 field = vec2(coord.x * aspect, coord.y) * 13.;
  field -= vec2(.21, .43) * clock;
  vec2 cell = floor(field);
  float seed = hash(cell);
  vec2 center = .5 + .26 * sin(vec2(seed * 24. + clock * .47, seed * 36.));
  float ember = (1. - smoothstep(.012, .054, length(fract(field) - center)))
              * smoothstep(.34, .91, seed) * (1. - smoothstep(.2, .88, coord.y));
  float ray = coord.x + .32 * (1. - coord.y);
  float shafts = pow(.5 + .5 * cos(ray * 39. + .35 * sin(clock * .17)), 5.);
  float haze = shafts * .08 * smoothstep(.5, .85, coord.x) * coord.y;
  float opacity = min(.76, ember + haze);
  gl_FragColor = vec4(vec3(1., .78, .40) * opacity, opacity);
}
