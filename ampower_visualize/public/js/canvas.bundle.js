import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let parentSphere;

function initScene(doctype, document_name) {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(120, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth / 1.5, window.innerHeight / 1.5);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.update();

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    parentSphere = new THREE.Mesh(geometry, material);
    parentSphere.addEventListener('click', () => {
        console.log("Entering")
    })

    scene.add(parentSphere);

    const parentText = createTextSprite(document_name);
    parentText.position.set(0, 1.5, 0);
    scene.add(parentText);

    animate();
}

function addConnectedSphere(text) {
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const newSphere = new THREE.Mesh(geometry, material);

    newSphere.position.set(3, 0, 0);
    scene.add(newSphere);

    const newText = createTextSprite(text);
    newText.position.set(3, 1.2, 0);
    scene.add(newText);

    const dir = new THREE.Vector3(3, 0, 0).normalize();
    const origin = new THREE.Vector3(0, 0, 0);
    const length = 3;
    const arrowHelper = new THREE.ArrowHelper(dir, origin, length, 0xffff00);
    scene.add(arrowHelper);
}

function createTextSprite(message) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = '30px Arial';
    context.fillStyle = 'white';
    context.fillText(message, 0, 30);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(2, 1, 1);

    return sprite;
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

window.add_parent_node = initScene;
window.add_child_node = addConnectedSphere;
