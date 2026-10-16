// Spread large throws into short flights instead of a tall, overlapping column.
// The schedule is shared by the renderer and deterministic physics checks.
export function planChipThrow({count,width,depth,angle,random=Math.random}) {
  const margin=.72,halfX=width/2-margin,halfZ=depth/2-margin;
  const tangentX=-Math.sin(angle),tangentZ=Math.cos(angle);
  const lanes=Math.max(1,Math.min(5,count)),laneSpan=(lanes-1)*.51;
  const centerX=Math.max(0,halfX-Math.abs(tangentX)*laneSpan),centerZ=Math.max(0,halfZ-Math.abs(tangentZ)*laneSpan);
  const startX=Math.max(-centerX,Math.min(centerX,Math.cos(angle)*halfX));
  const startZ=Math.max(-centerZ,Math.min(centerZ,Math.sin(angle)*halfZ));
  return Array.from({length:count},(_,i)=>{
    const lane=(i%lanes-(lanes-1)/2)*1.02;
    const x=Math.max(-halfX,Math.min(halfX,startX+tangentX*lane));
    const z=Math.max(-halfZ,Math.min(halfZ,startZ+tangentZ*lane));
    const targetX=(random()-.5)*Math.min(4.4,1.4+count*.035,width*.42);
    const targetZ=(random()-.5)*Math.min(2.2,.6+count*.02,depth*.36)+1;
    return {delay:Math.floor(i/lanes)*.055,options:{x,y:.62,z,flat:true,
      velocity:[(targetX-x)/.82,2.2+random()*.25,(targetZ-z)/.82],
      spin:[(random()-.5)*.5,(random()-.5)*1.2,(random()-.5)*.5]}};
  });
}
