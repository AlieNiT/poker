import * as CANNON from 'cannon-es';

export class ChipPhysics {
  constructor(floorHeight = 0, onImpact = () => {}) {
    this.world = new CANNON.World({gravity: new CANNON.Vec3(0,-9.81,0),allowSleep:true});
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 40;
    this.world.solver.tolerance = .00001;
    this.chipMaterial = new CANNON.Material('chip');
    this.feltMaterial = new CANNON.Material('felt');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.chipMaterial,this.feltMaterial,{friction:1.1,restitution:.015,contactEquationStiffness:1e6,contactEquationRelaxation:6}));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.chipMaterial,this.chipMaterial,{friction:.5,restitution:.025,contactEquationStiffness:1e6,contactEquationRelaxation:6}));
    this.floor = new CANNON.Body({mass:0,material:this.feltMaterial,shape:new CANNON.Plane()});
    this.floor.quaternion.setFromEuler(-Math.PI/2,0,0);this.floor.position.y=floorHeight;this.world.addBody(this.floor);
    this.shape = new CANNON.Cylinder(.47,.47,.085,12);
    this.chips = new Set();this.walls=[];this.onImpact=onImpact;
    this.lastImpact=-1;this.contactTimes=new Map();this.accumulator=0;
  }
  create({x=0,y=1,z=0,rotation=Math.PI/2,velocity,spin,flat=false}={}) {
    const body=new CANNON.Body({mass:.011,material:this.chipMaterial,shape:this.shape,allowSleep:true,sleepSpeedLimit:.3,sleepTimeLimit:.6,linearDamping:.35,angularDamping:.8});
    body.position.set(x,y,z);body.quaternion.setFromEuler(0,rotation,0);
    // Pot chips slide, bounce and spin on the tabletop. Keeping them flat
    // avoids unstable edge contacts between dozens of very thin cylinders.
    if(flat)body.angularFactor.set(0,1,0);
    // Newly placed chips must start above neighbours, rather than intersecting
    // them and making the solver violently eject both chips.
    this.placeClear(body);
    if(velocity)body.velocity.set(...velocity);if(spin)body.angularVelocity.set(...spin);
    if(flat){body.angularVelocity.x=0;body.angularVelocity.z=0;}
    body.addEventListener('collide',event=>{
      if(body.holdTarget || event.body.holdTarget)return;
      const impact=event.contact.getImpactVelocityAlongNormal();
      // Solver velocity spikes do not necessarily move a resting chip. Actual
      // pose changes and loss of support reset its settling window in step().
      const key=this.contactKey(body,event.body);
      const separated=this.world.time-(this.contactTimes.get(key)??-Infinity)>.06;
      // A solver contact briefly disappearing is not a new audible impact.
      // The normal velocity is signed: separating chips must remain silent.
      if(separated && impact>.65 && this.world.time-this.lastImpact>.11){this.lastImpact=this.world.time;this.onImpact(impact);}
    });
    this.world.addBody(body);this.chips.add(body);return body;
  }
  remove(body){
    // Pulling a chip out from underneath a sleeping pile must let the pile fall.
    this.wakeAbove(body);
    this.world.removeBody(body);this.chips.delete(body);
  }
  wakeAbove(body){
    for(const other of this.chips)if(other!==body && !other.holdTarget && other.position.y>=body.position.y && other.position.y-body.position.y<1.1 && Math.hypot(other.position.x-body.position.x,other.position.z-body.position.z)<.94){
      delete other.restPose;other.wakeUp();
    }
  }
  verticalExtent(body){
    const axis=body.quaternion.vmult(new CANNON.Vec3(0,1,0));
    return .0425*Math.abs(axis.y)+.47*Math.sqrt(Math.max(0,1-axis.y*axis.y));
  }
  placeClear(body){
    const extent=this.verticalExtent(body);
    for(let pass=0;pass<=this.chips.size;pass++){
      let raised=false;
      for(const other of this.chips){
        if(other===body || other.holdTarget || Math.hypot(body.position.x-other.position.x,body.position.z-other.position.z)>=.94)continue;
        const clearance=this.verticalExtent(other)+extent+.001;
        if(Math.abs(body.position.y-other.position.y)<clearance){body.position.y=other.position.y+clearance;raised=true;}
      }
      if(!raised)break;
    }
    body.aabbNeedsUpdate=true;
  }
  clear(){for(const body of [...this.chips])this.remove(body);}
  bounds(width,depth){
    this.boundWidth=width;this.boundDepth=depth;
    for(const wall of this.walls)this.world.removeBody(wall);this.walls=[];
    for(const axis of ['x','z'])for(const sign of [-1,1]){
      const shape=axis==='x'?new CANNON.Box(new CANNON.Vec3(.12,3,depth/2+1)):new CANNON.Box(new CANNON.Vec3(width/2+1,3,.12));
      const wall=new CANNON.Body({mass:0,material:this.feltMaterial,shape});
      wall.position.set(axis==='x'?sign*width/2:0,1,axis==='z'?sign*depth/2:0);
      this.world.addBody(wall);this.walls.push(wall);
    }
  }
  hold(body,x,y,z){
    if(!body.holdTarget){
      this.wakeAbove(body);body.pickupMask=body.collisionFilterMask;
      body.collisionFilterMask=0;body.type=CANNON.Body.KINEMATIC;body.updateMassProperties();
    }
    delete body.restPose;
    body.holdTarget=new CANNON.Vec3(x,y,z);body.position.copy(body.holdTarget);
    body.force.setZero();body.torque.setZero();body.sleep();body.aabbNeedsUpdate=true;
  }
  release(body){
    if(body.holdTarget){
      delete body.holdTarget;body.velocity.setZero();body.angularVelocity.setZero();
      body.force.setZero();body.torque.setZero();
      body.collisionFilterMask=body.pickupMask;delete body.pickupMask;
      body.type=CANNON.Body.DYNAMIC;body.updateMassProperties();
      if(this.boundWidth){
        const x=Math.max(0,this.boundWidth/2-.595),z=Math.max(0,this.boundDepth/2-.595);
        body.position.x=Math.max(-x,Math.min(x,body.position.x));body.position.z=Math.max(-z,Math.min(z,body.position.z));
      }
      this.placeClear(body);body.wakeUp();
    }
  }
  step(elapsed,beforeStep){
    // Thin chips need substeps shorter than a fast chip can cross its own thickness.
    const fixedStep=1/240;
    this.accumulator+=Math.min(Math.max(elapsed,0),.06);
    while(this.accumulator+1e-10>=fixedStep){
      beforeStep?.();
      this.world.step(fixedStep);this.accumulator-=fixedStep;
      const supported=new Set();
      for(const contact of this.world.contacts){
        this.contactTimes.set(this.contactKey(contact.bi,contact.bj),this.world.time);
        if(contact.ni.y>.35)supported.add(contact.bj);
        if(contact.ni.y<-.35)supported.add(contact.bi);
      }
      for(const body of this.chips){
        if(body.holdTarget || body.sleepState===CANNON.Body.SLEEPING){delete body.restPose;continue;}
        if(!supported.has(body)){
          // A one-substep gap in a resting contact is solver noise. Preserve
          // its pose window briefly, but only sleep while actually supported.
          if(this.world.time-(body.lastSupportedAt ?? -Infinity)>.05)delete body.restPose;
          continue;
        }
        body.lastSupportedAt=this.world.time;
        const rest=body.restPose;
        const q=body.quaternion;
        // Thin stacked chips can have noisy instantaneous velocities even when
        // their actual poses barely move. Sleep supported, stable poses too;
        // never use this rule for falling, sliding, or finger-held chips.
        if(!rest || body.position.distanceTo(rest.position)>.025 || Math.abs(q.x*rest.rotation.x+q.y*rest.rotation.y+q.z*rest.rotation.z+q.w*rest.rotation.w)<Math.cos(.08/2)){
          body.restPose={position:body.position.clone(),rotation:q.clone(),since:this.world.time};
        }else if(this.world.time-rest.since>.5){body.sleep();delete body.restPose;}
      }
    }
    for(const [key,time]of this.contactTimes)if(this.world.time-time>1)this.contactTimes.delete(key);
  }
  contactKey(a,b){return a.id<b.id?`${a.id}:${b.id}`:`${b.id}:${a.id}`;}
  get active(){return [...this.chips].some(b=>b.sleepState!==CANNON.Body.SLEEPING);}
}
