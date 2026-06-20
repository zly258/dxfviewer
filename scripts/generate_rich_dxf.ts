import fs from 'fs';
import path from 'path';

function generateRichDxf() {
    const lines: string[] = [];

    const add = (code: number | string, val: number | string) => {
        lines.push(code.toString(), val.toString());
    };

    add(0, 'SECTION');
    add(2, 'HEADER');
    add(9, '$ACADVER');
    add(1, 'AC1027');
    add(0, 'ENDSEC');

    add(0, 'SECTION');
    add(2, 'TABLES');

    // Linetype table
    add(0, 'TABLE');
    add(2, 'LTYPE');
    add(70, 2);
    add(0, 'LTYPE');
    add(2, 'CONTINUOUS');
    add(70, 0);
    add(3, 'Solid line');
    add(72, 65);
    add(73, 0);
    add(40, 0.0);
    add(0, 'LTYPE');
    add(2, 'DASHED');
    add(70, 0);
    add(3, 'Dashed line');
    add(72, 65);
    add(73, 2);
    add(40, 10.0);
    add(49, 5.0);
    add(49, -5.0);
    add(0, 'ENDTAB');

    // Layer table
    add(0, 'TABLE');
    add(2, 'LAYER');
    add(70, 3);
    const layers = ['0', 'Walls', 'Furniture', 'Text'];
    const colors = [7, 1, 3, 2]; // White, Red, Green, Yellow
    for (let i = 0; i < layers.length; i++) {
        add(0, 'LAYER');
        add(2, layers[i]);
        add(70, 0);
        add(62, colors[i]);
        add(6, 'CONTINUOUS');
    }
    add(0, 'ENDTAB');

    // Style table
    add(0, 'TABLE');
    add(2, 'STYLE');
    add(70, 1);
    add(0, 'STYLE');
    add(2, 'STANDARD');
    add(70, 0);
    add(40, 0.0);
    add(41, 1.0);
    add(50, 0.0);
    add(71, 0);
    add(42, 0.2);
    add(3, 'txt.shx');
    add(4, '');
    add(0, 'ENDTAB');

    add(0, 'ENDSEC');

    // Blocks
    add(0, 'SECTION');
    add(2, 'BLOCKS');
    
    // Create a block "CHAIR"
    add(0, 'BLOCK');
    add(2, 'CHAIR');
    add(70, 0);
    add(10, 0); add(20, 0); add(30, 0);
    add(3, 'CHAIR');
    add(1, '');
    
    // Chair geometry (a square with a curve)
    add(0, 'LWPOLYLINE');
    add(8, 'Furniture');
    add(90, 4);
    add(70, 1);
    add(10, -20); add(20, -20);
    add(10, 20); add(20, -20);
    add(10, 20); add(20, 20);
    add(10, -20); add(20, 20);
    
    add(0, 'ARC');
    add(8, 'Furniture');
    add(10, 0); add(20, 20); add(30, 0);
    add(40, 20);
    add(50, 0); add(51, 180);

    add(0, 'ENDBLK');
    add(8, '0');

    add(0, 'ENDSEC');

    // Entities
    add(0, 'SECTION');
    add(2, 'ENTITIES');

    // 1. A grid of lines
    for (let i = -500; i <= 500; i += 100) {
        add(0, 'LINE');
        add(8, '0');
        add(10, i); add(20, -500); add(30, 0);
        add(11, i); add(21, 500); add(31, 0);
        add(62, 8); // Dark gray

        add(0, 'LINE');
        add(8, '0');
        add(10, -500); add(20, i); add(30, 0);
        add(11, 500); add(21, i); add(31, 0);
        add(62, 8);
    }

    // 2. A complex spline
    add(0, 'SPLINE');
    add(8, 'Walls');
    add(70, 8); // Planar
    add(71, 3); // Degree
    add(72, 8); // Knots
    add(73, 4); // Control points
    add(74, 0); // Fit points
    add(40, 0); add(40, 0); add(40, 0); add(40, 0);
    add(40, 1); add(40, 1); add(40, 1); add(40, 1);
    add(10, 0); add(20, 0); add(30, 0);
    add(10, 100); add(20, 200); add(30, 0);
    add(10, 200); add(20, -100); add(30, 0);
    add(10, 300); add(20, 100); add(30, 0);

    // 3. Matrix of Block Inserts
    for (let x = -400; x <= 400; x += 150) {
        for (let y = -400; y <= 400; y += 150) {
            add(0, 'INSERT');
            add(8, 'Furniture');
            add(2, 'CHAIR');
            add(10, x); add(20, y); add(30, 0);
            add(41, 1.5); // scale x
            add(42, 1.5); // scale y
            add(50, (x + y) % 360); // random rotation
        }
    }

    // 4. Texts with different rotations and MTEXT
    for (let a = 0; a < 360; a += 45) {
        add(0, 'TEXT');
        add(8, 'Text');
        add(10, 300 * Math.cos(a * Math.PI / 180));
        add(20, 300 * Math.sin(a * Math.PI / 180));
        add(30, 0);
        add(40, 20); // Height
        add(1, `Angle ${a}° Text`);
        add(50, a); // Rotation
    }

    // MTEXT
    add(0, 'MTEXT');
    add(8, 'Text');
    add(10, -300); add(20, 300); add(30, 0);
    add(40, 15); // Nominal text height
    add(41, 150); // Reference rectangle width
    add(71, 1); // Top left
    add(1, 'This is a very long multiline text\\Pthat should wrap correctly\\Pwithin its bounding box\\Pand scale perfectly.');

    // 5. Some circles and ellipses
    add(0, 'CIRCLE');
    add(8, 'Walls');
    add(10, 0); add(20, 0); add(30, 0);
    add(40, 450);

    add(0, 'ELLIPSE');
    add(8, 'Walls');
    add(10, 0); add(20, 0); add(30, 0);
    add(11, 480); add(21, 0); add(31, 0);
    add(40, 0.5); // Ratio

    // 6. Hatched boundary using lines to simulate complexity
    for (let i = 0; i < 100; i += 5) {
        add(0, 'LINE');
        add(8, '0');
        add(10, -200 + i); add(20, -200); add(30, 0);
        add(11, -200 + i); add(21, -100); add(31, 0);
    }

    add(0, 'ENDSEC');
    add(0, 'EOF');

    return lines.join('\n');
}

const dir = path.join(process.cwd(), 'dxfviewer-example', 'public');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

const p = path.join(dir, 'comprehensive.dxf');
fs.writeFileSync(p, generateRichDxf(), 'utf8');

// Copy to public too for good measure
const pubDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(pubDir)) {
    fs.mkdirSync(pubDir, { recursive: true });
}
fs.writeFileSync(path.join(pubDir, 'comprehensive.dxf'), generateRichDxf(), 'utf8');

console.log('Rich DXF generated at ' + p);
