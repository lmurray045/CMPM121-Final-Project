"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PlantDefinitions_js_1 = require("../utils/PlantDefinitions.js");
//Cell Prefab
class Cell extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, texture, row, col) {
        super(scene, x, y, texture);
        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.scene = scene;
        this.row = row;
        this.col = col;
        this.setImmovable(true);
        // Initial properties
        this.plant = null;
        this.frameNumber = 0;
    }
    sowCell(plantType) {
        const plantTypeCode = plantType === "grass" ? 1 : plantType === "flower" ? 2 : 3;
        if (this.scene.getPlantType(this.row, this.col) === 0) {
            this.scene.recordState();
            this.scene.setPlantType(this.row, this.col, plantTypeCode);
            this.scene.setGrowthLevel(this.row, this.col, 0);
            console.log(`Planted ${plantType} at (${this.row}, ${this.col})`);
            this.plant = this.scene.add.sprite(this.x, this.y, plantType);
            this.plant.anims.play(`sow-${plantType}`, true);
        }
    }
    reapCell() {
        if (this.scene.getPlantType(this.row, this.col) !== 0) {
            this.scene.recordState();
            this.scene.setPlantType(this.row, this.col, 0);
            this.scene.setGrowthLevel(this.row, this.col, 0);
            console.log(`Reaping plant at (${this.row}, ${this.col})`);
            if (this.plant) {
                this.plant.destroy();
                this.plant = null;
            }
        }
    }
    checkNeighborCells() {
        var _a;
        //Get the surrounding cells in all directions (left, right, up, down)
        const directions = [
            { x: -1, y: 0 }, //left
            { x: 1, y: 0 }, //right
            { x: 0, y: -1 }, //up
            { x: 0, y: 1 }, //down
        ];
        let adjacentSameTypeCount = 0;
        let adjacentLowerTierCount = 0;
        //Loop through the directions to check adjacent cells
        for (let dir of directions) {
            const adjCell = (_a = this.scene.cellGrid[this.y / 32 + dir.y]) === null || _a === void 0 ? void 0 : _a[this.x / 32 + dir.x];
            if (adjCell && adjCell.checkIsPlanted()) {
                if (adjCell.type === this.type) {
                    adjacentSameTypeCount++;
                }
                else if (this.getPlantTier(adjCell.type) ===
                    this.getPlantTier(this.type) - 1) {
                    adjacentLowerTierCount++;
                }
            }
        }
        //Grass has special rules; it cannot grow from "none" adjacent cells
        if (this.type === "grass" && adjacentSameTypeCount < 3) {
            return adjacentSameTypeCount >= 3; //Grass needs at least 3 adjacent grass cells
        }
        //For flower and shrub, check for either 3 same type or 3 lower tier
        return adjacentSameTypeCount >= 3 || adjacentLowerTierCount >= 3;
    }
    checkCellGrowth() {
        const plantTypeCode = this.scene.getPlantType(this.row, this.col);
        const waterLevel = this.scene.getWaterLevel(this.row, this.col);
        const growthLevel = this.scene.getGrowthLevel(this.row, this.col);
        const sunLevel = this.scene.sunLevel;
        const plantDef = PlantDefinitions_js_1.plantDefinitions.find((def) => def.typeCode === plantTypeCode);
        if (!plantDef) {
            return;
        }
        // loop through plant's growth conditions
        for (const condition of plantDef.growthConditions) {
            if (sunLevel >= condition.minSun &&
                waterLevel >= condition.minWater &&
                growthLevel < 3) {
                this.growPlant(plantDef.type, growthLevel, waterLevel, condition.waterRequired);
                break;
            }
        }
    }
    growPlant(plantType, growthLevel, waterLevel, waterRequirement) {
        if (growthLevel < 3) {
            growthLevel++;
            this.scene.setGrowthLevel(this.row, this.col, growthLevel);
            // update water level
            this.scene.setWaterLevel(this.row, this.col, waterLevel - waterRequirement);
            // update animation
            if (this.plant) {
                this.plant.anims.play(`${growthLevel}-${plantType}`, true);
            }
        }
        else {
            console.log(`${plantType.charAt(0).toUpperCase() + plantType.slice(1)} at (${this.row}, ${this.col}) is already fully grown.`);
        }
    }
    checkIsPlanted() {
        return this.planted;
    }
    addWater(newWaterVal) {
        this.waterLevel += newWaterVal;
    }
    //Helper function to determine the tier of a plant type
    getPlantTier(plantType) {
        switch (plantType) {
            case "grass":
                return 1;
            case "flower":
                return 2;
            case "shrub":
                return 3;
            default:
                return 0;
        }
    }
    updateSprite(plantType, growthLevel) {
        if (plantType == 0) {
            if (this.plant) {
                this.plant.destroy();
                this.plant = null;
            }
            this.setTexture("dirtTile");
            this.setFrame(0);
        }
        else {
            const plantTexture = {
                1: "grass",
                2: "flower",
                3: "shrub",
            }[plantType];
            if (!this.plant) {
                this.plant = this.scene.add.sprite(this.x, this.y, plantTexture);
                this.plant.setDepth(this.depth + 1);
            }
            this.plant.anims.play(`${growthLevel}-${plantTexture}`, true);
        }
    }
}
exports.default = Cell;
//# sourceMappingURL=Cell.js.map