import Phaser from 'phaser';
import ScenarioParser, { Result, EventDay, NonEventSection } from "../utils/ScenarioParser2.ts";
import { plantDefinitions } from "../utils/PlantDefinitions.js";
import Cell from "../prefabs/Cell.js";
import { Player, StateMachine } from "../prefabs/Player.ts"
import { game } from "../main.ts"

class PlayScene extends Phaser.Scene {
  day: number = 1;
  sunLevel: number = 0
  waterLevel: number = 0;
  waterMultiplier: number = 1;
  playerSeedChoice: string = "grass";
  textdepth: number = 11;
  playerdepth: number = 10;
  victoryConditions: NonEventSection = {};
  weatherPolicy: NonEventSection = {};
  eventsQueue: EventDay[] = [];
  undoStack = [];
  redoStack = [];
  playerFSM: StateMachine | null = null;
  player: Player | null = null;

  //key bind variables
  keys: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  advanceKey: Phaser.Input.Keyboard.Key | null = null;
  QKey: Phaser.Input.Keyboard.Key | null = null;
  WKey: Phaser.Input.Keyboard.Key | null = null;
  EKey: Phaser.Input.Keyboard.Key | null = null;
  XKey: Phaser.Input.Keyboard.Key | null = null;
  CKey: Phaser.Input.Keyboard.Key | null = null;
  undoKey: Phaser.Input.Keyboard.Key | null = null;
  redoKey: Phaser.Input.Keyboard.Key | null = null;

  //plant and grid variables
  bytesPerCell: number = 3;
  cellGroup = this.add.group();
  gridWidth: number = 15;
  gridHeight: number = 15;
  gridState: Uint8Array = new Uint8Array(this.gridWidth * this.gridHeight * this.bytesPerCell);

  //text variables
  dayText: Phaser.GameObjects.Text | null = null;
  sunLevelText: Phaser.GameObjects.Text | null = null;
  waterLevelText: Phaser.GameObjects.Text | null = null;
  seedChoiceText: Phaser.GameObjects.Text | null = null;

  //player variables
  playerSowTargetBox: Phaser.GameObjects.Sprite | null = null;
  playerReapTargetBox: Phaser.GameObjects.Sprite | null = null;

  constructor() {
    super("PlayScene");
  }

  async loadScenario(filePath: RequestInfo | URL) {
    const response = await fetch(filePath);
    const text = await response.text();
    const parser = new ScenarioParser(text);
    return parser.parse();
  }

  getPlantIcon(seedChoice: string) {
    const plantDef = plantDefinitions.find(
      (plant) => plant.type === seedChoice
    );
    return plantDef ? plantDef.icon : "";
  }

  create() {
    this.createUI();
    this.bindKeys();
    this.createPlayer();

    //Loading External DSL and applying data
    this.loadScenario("assets/scenarios/defaultScenario.txt").then(
      (scenario) => {
        this.day = scenario.StartingConditions.Day as number;
        this.sunLevel = scenario.StartingConditions.SunLevel as number;
        this.waterLevel = scenario.StartingConditions.WaterLevel as number;
        this.playerSeedChoice = scenario.StartingConditions.PlayerSeedChoice as string;

        this.victoryConditions = scenario.VictoryConditions as NonEventSection;
        this.weatherPolicy = scenario.WeatherPolicy as NonEventSection;
        this.eventsQueue = Object.entries(scenario.Events)
          .map(([day, event]) => {
            return { day: parseInt(day), ...event };
          })
          .sort((a: { day: number; }, b: { day: number; }) => a.day - b.day);

        this.createGrid();
        this.createInteractions();
        this.updateGrid();
        this.updateUI();

        this.createSaveLoadUI();
        this.autoSaveInitilizer();
      }
    );
  }

  update() {
    if(this.playerFSM){
      this.playerFSM.update();
    }
    if (Phaser.Input.Keyboard.JustDown(this.advanceKey as Phaser.Input.Keyboard.Key)) {
      this.recordState();
      this.advanceDay();
    }

    if (Phaser.Input.Keyboard.JustDown(this.QKey as Phaser.Input.Keyboard.Key)) {
      this.updateSeedChoice("grass");
    } else if (Phaser.Input.Keyboard.JustDown(this.WKey as Phaser.Input.Keyboard.Key)) {
      this.updateSeedChoice("flower");
    } else if (Phaser.Input.Keyboard.JustDown(this.EKey as Phaser.Input.Keyboard.Key)) {
      this.updateSeedChoice("shrub");
    }

    if (Phaser.Input.Keyboard.JustDown(this.undoKey as Phaser.Input.Keyboard.Key)) {
      this.undo();
    } else if (Phaser.Input.Keyboard.JustDown(this.redoKey as Phaser.Input.Keyboard.Key)) {
      this.redo();
    }
  }

  advanceDay() {
    this.pushUndoState();
    this.day++;
    this.generateWeather();

    const event = this.eventsQueue.find((e) => e.day === this.day);
    if (event) {
      if (event.SunRange) this.weatherPolicy.SunRange = event.SunRange;
      if (event.WaterRange) this.weatherPolicy.WaterRange = event.WaterRange;
      if (event.WaterMultiplier) this.waterMultiplier = event.WaterMultiplier as number;
      if (event.Message) alert(event.Message);
      if (event.MaturePlantsRequired)
        this.victoryConditions.MaturePlantsRequired =
          event.MaturePlantsRequired;
    }

    this.updateUI();
    this.updateGrid();
    this.checkEndCondition();
  }

  bindKeys() {
    const keyboard = this.input.keyboard;
    if(keyboard) {
    this.keys = keyboard.createCursorKeys();
    this.XKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.CKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
    this.QKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.WKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.EKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.advanceKey = keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );
    this.undoKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.redoKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Y);
    }
  }

  //helper functions to access byte array
  getCellIndex(row: number, col: number) {
    return (row * this.gridWidth + col) * this.bytesPerCell;
  }

  getPlantType(row: number, col: number) {
    return this.gridState[this.getCellIndex(row, col)];
  }

  getWaterLevel(row: number, col: number) {
    return this.gridState[this.getCellIndex(row, col) + 1];
  }

  getGrowthLevel(row: number, col: number) {
    return this.gridState[this.getCellIndex(row, col) + 2];
  }

  setPlantType(row: number, col: number, type: number) {
    this.gridState[this.getCellIndex(row, col)] = type;
  }

  setWaterLevel(row: number, col: number, water: number) {
    this.gridState[this.getCellIndex(row, col) + 1] = water;
  }

  setGrowthLevel(row: number, col: number, growth: number) {
    this.gridState[this.getCellIndex(row, col) + 2] = growth;
  }

  createGrid() {
    const cellSize = 32;

    this.cellGroup = this.add.group();
    this.gridWidth = 15;
    this.gridHeight = 15;
    //For each cell: plantType, waterLevel, growthLevel
    this.bytesPerCell = 3;

    const totalCells = this.gridWidth * this.gridHeight;
    //byte array
    this.gridState = new Uint8Array(totalCells * this.bytesPerCell);

    for (let row = 0; row < this.gridHeight; row++) {
      for (let col = 0; col < this.gridWidth; col++) {
        //init the byte array and make them start with nothing
        const index = this.getCellIndex(row, col);
        this.gridState[index] = 0;
        this.gridState[index + 1] = 0;
        this.gridState[index + 2] = 0;

        //now create Cell prefab
        const x = col * cellSize + cellSize / 2;
        const y = row * cellSize + cellSize / 2;
        const cell = new Cell(this, x, y, "dirtTile", row, col);
        this.cellGroup.add(cell);
      }
    }
  }

  createUI() {
    this.dayText = this.add
      .text(
        (game.config.width as number) / 2,
        (game.config.height as number) / 10,
        `Day: ${this.day}`,
        {
          fontSize: "24px",
          color: "#ffffff",
        }
      )
      .setOrigin(0.5, 0.5);
    this.dayText.setDepth(this.textdepth);

    this.sunLevelText = this.add
      .text(
        game.config.width as number / 2,
        (game.config.height as number / 10) * 1.5,
        `Sun Level: ${this.sunLevel}`,
        {
          fontSize: "18px",
          color: "#ffffff",
        }
      )
      .setOrigin(0.5, 0.5);
    this.sunLevelText.setDepth(this.textdepth);

    this.waterLevelText = this.add
      .text(
        game.config.width as number / 2,
        (game.config.height as number / 10) * 2,
        `Water Level: ${this.waterLevel}`,
        {
          fontSize: "18px",
          color: "#ffffff",
        }
      )
      .setOrigin(0.5, 0.5);
    this.waterLevelText.setDepth(this.textdepth);

    this.seedChoiceText = this.add
      .text(
        game.config.width as number / 2,
        (game.config.height as number / 10) * 2.5,
        `Seed Choice: ${this.playerSeedChoice}`,
        { fontSize: "18px", color: "#ffffff" }
      )
      .setOrigin(0.5, 0.5);
    this.seedChoiceText.setDepth(this.textdepth);
  }

  createPlayer() {
    this.player = new Player(this, 100, 100, "character", 0, "down");
    this.playerSowTargetBox = this.physics.add.sprite(-10, -10).setSize(1, 1); //TargetBoxes starts off screen
    this.playerReapTargetBox = this.physics.add.sprite(-10, -10).setSize(1, 1);
    this.player.setDepth(this.playerdepth);
  }

  createInteractions() {
    //sowing
    this.physics.add.overlap(
      this.cellGroup,
      this.playerSowTargetBox as Phaser.GameObjects.Sprite,
      (cell) => {
        cell.sowCell(this.playerSeedChoice);
      }
    );

    //reaping
    this.physics.add.overlap(
      this.cellGroup,
      this.playerReapTargetBox as Phaser.GameObjects.Sprite,
      (cell) => {
        cell.reapCell();
      }
    );
  }

  createSaveLoadUI() {
    this.saveButton1 = this.createSaveButton(0, 1);
    this.saveButton2 = this.createSaveButton(25, 2);
    this.saveButton3 = this.createSaveButton(50, 3);
    this.loadButton1 = this.createLoadButton(0, 1);
    this.loadButton2 = this.createLoadButton(25, 2);
    this.loadButton3 = this.createLoadButton(50, 3);
  }

  createSaveButton(yOffset: number, slotNumber: number) {
    const saveButton = this.add
      .text(10, 400 + yOffset, `Save Slot ${slotNumber.toString()}`, {
        fill: "#ffffff",
      })
      .setInteractive()
      .on("pointerdown", () => this.saveGame(slotNumber));
    return saveButton;
  }

  createLoadButton(yOffset: number, slotNumber: number) {
    const loadButton = this.add
      .text(360, 400 + yOffset, `Load Slot ${slotNumber.toString()}`, {
        fill: "#ffffff",
      })
      .setInteractive()
      .on("pointerdown", () => this.loadGame(slotNumber));
    return loadButton;
  }

  generateWeather() {
    const [sunMin, sunMax] = this.weatherPolicy.SunRange;
    const [waterMin, waterMax] = this.weatherPolicy.WaterRange;

    this.sunLevel = Math.floor(Math.random() * (sunMax - sunMin + 1)) + sunMin;
    this.waterLevel =
      (Math.floor(Math.random() * (waterMax - waterMin + 1)) + waterMin) *
      this.waterMultiplier;
  }

  updateUI() {
    const seedIcon = this.getPlantIcon(this.playerSeedChoice);
    (this.dayText as Phaser.GameObjects.Text).setText(`Day: ${this.day}`);
    (this.sunLevelText as Phaser.GameObjects.Text).setText(`Sun Level: ${this.sunLevel}`);
    (this.waterLevelText as Phaser.GameObjects.Text).setText(`Water Level: ${this.waterLevel}`);
    (this.seedChoiceText as Phaser.GameObjects.Text).setText(
      `Seed Choice: ${seedIcon} ${this.playerSeedChoice}`
    );
  }

  updateSeedChoice(seedChoice: string) {
    this.pushUndoState();
    console.log("Now planting " + seedChoice);

    const seedIcon = this.getPlantIcon(seedChoice);
    (this.seedChoiceText as Phaser.GameObjects.Text).setText(`Seed Choice: ${seedIcon} ${seedChoice}`);
    this.playerSeedChoice = seedChoice;
  }

  updateGrid() {
    this.cellGroup.getChildren().forEach((cell: { row: any; col: any; checkCellGrowth: () => void; }) => {
      const row = cell.row;
      const col = cell.col;

      //Check if planted first
      if (this.getPlantType(row, col) !== 0) {
        cell.checkCellGrowth();
      }

      //then add water to cell
      this.setWaterLevel(
        row,
        col,
        this.getWaterLevel(row, col) + this.waterLevel
      );
    });
  }

  checkEndCondition() {
    let maturePlantCount = 0;
    for (let row = 0; row < this.gridHeight; row++) {
      for (let col = 0; col < this.gridWidth; col++) {
        if (this.getGrowthLevel(row, col) >= 3) {
          maturePlantCount++;
        }
      }
    }

    if (maturePlantCount >= (this.victoryConditions.MaturePlantsRequired as number)) {
      this.gameOver("win");
      return;
    }

    if (this.day >= (this.victoryConditions.MaximumDays as number)) {
      this.gameOver("lose");
      return;
    }
  }

  gameOver(outcome: string) {
    if (outcome === "lose") {
      alert("End Condition Not Met: You Lose!");
    } else {
      alert("End Condition Met: You Win!");
    }
  }

  //Save-Load Implementation
  saveGame(slot: any) {
    const gameData = {
      day: this.day,
      sunLevel: this.sunLevel,
      waterLevel: this.waterLevel,
      playerSeedChoice: this.playerSeedChoice,
      gridState: Array.from(this.gridState), // Convert Uint8Array to array for JSON compatibility
      undoStack: this.undoStack.map((state) => JSON.stringify(state)), // Serialize each state
      redoStack: this.redoStack.map((state) => JSON.stringify(state)), // Serialize each state
    };

    const key = `saveSlot${slot}`;
    localStorage.setItem(key, JSON.stringify(gameData));
    alert(`Game Saved to Slot ${slot}`);
  }

  loadGame(slot: any) {
    const key = `saveSlot${slot}`;
    const savedData = JSON.parse(localStorage.getItem(key));

    if (!savedData) {
      alert(`No saved data found in slot ${slot}`);
      return;
    }

    // Restore main game state
    this.day = savedData.day;
    this.sunLevel = savedData.sunLevel;
    this.waterLevel = savedData.waterLevel;
    this.playerSeedChoice = savedData.playerSeedChoice;
    this.gridState = new Uint8Array(savedData.gridState);

    // Restore undo/redo stacks
    this.undoStack = (savedData.undoStack || []).map((state: string) =>
      JSON.parse(state)
    );
    this.redoStack = (savedData.redoStack || []).map((state: string) =>
      JSON.parse(state)
    );

    this.updateUI();
    this.cellGroup.getChildren().forEach((cell: { row: any; col: any; updateSprite: (arg0: any, arg1: any) => void; }) => {
      const row = cell.row;
      const col = cell.col;
      const plantType = this.getPlantType(row, col);
      const growthLevel = this.getGrowthLevel(row, col);
      cell.updateSprite(plantType, growthLevel);
    });

    alert(`Game Loaded from Slot ${slot}`);
  }

  autoSave() {
    const gameData = {
      day: this.day,
      sunLevel: this.sunLevel,
      waterLevel: this.waterLevel,
      playerSeedChoice: this.playerSeedChoice,
      gridState: Array.from(this.gridState), // Converted into a regular array for JSON compatibility
      undoStack: this.undoStack, // Save undo stack
      redoStack: this.redoStack, // Save redo stack
    };

    // Save to local storage
    const key = `autoSave`;
    localStorage.setItem(key, JSON.stringify(gameData));
    console.log(`Successful Autosave!`);
  }

  loadAutoSave() {
    const key = `autoSave`;
    const savedData = JSON.parse(localStorage.getItem(key));

    if (!savedData) {
      alert(`No autosave detected`);
      return;
    }

    // Restoring global variables
    this.day = savedData.day;
    this.sunLevel = savedData.sunLevel;
    this.waterLevel = savedData.waterLevel;
    this.playerSeedChoice = savedData.playerSeedChoice;
    this.gridState = new Uint8Array(savedData.gridState); // Convert back to Uint8Array

    // Restore undo/redo stacks
    this.undoStack = savedData.undoStack || [];
    this.redoStack = savedData.redoStack || [];

    // Update the UI and cells
    this.updateUI();
    this.cellGroup.getChildren().forEach((cell: { row: any; col: any; updateSprite: (arg0: any, arg1: any) => void; }) => {
      const row = cell.row;
      const col = cell.col;

      const plantType = this.getPlantType(row, col);
      const growthLevel = this.getGrowthLevel(row, col);

      cell.updateSprite(plantType, growthLevel);
    });

    console.log(`Autosave Loaded Successfully`);
  }
  autoSaveInitilizer() {
    window.addEventListener("beforeunload", () => {
      this.autoSave();
    });
    const savedData = JSON.parse(localStorage.getItem("autoSave"));
    if (savedData) {
      const userChoice = window.confirm(
        "Do you want to load from the autosave? (Click Cancel for to clear the autosave)"
      );
      if (userChoice) {
        this.loadAutoSave();
      } else {
        localStorage.removeItem("autoSave");
      }
    }
  }

  //Undo/Redo Implementation
  recordState() {
    const currentState = {
      day: this.day,
      sunLevel: this.sunLevel,
      waterLevel: this.waterLevel,
      playerSeedChoice: this.playerSeedChoice,
      gridState: Array.from(this.gridState), //Copy the grid state
    };
    this.undoStack.push(currentState);
    this.redoStack = []; //Clear redo stack on new action
  }

  undo() {
    if (this.undoStack.length > 0) {
      //Push current state to redo stack before undoing
      this.redoStack.push({
        day: this.day,
        sunLevel: this.sunLevel,
        waterLevel: this.waterLevel,
        playerSeedChoice: this.playerSeedChoice,
        gridState: Array.from(this.gridState), //Convert to JSON-compatible format
      });

      //Restore state from undo stack
      const previousState = this.undoStack.pop();
      if(previousState){
        this.day = previousState.day;
        this.sunLevel = previousState.sunLevel;
        this.waterLevel = previousState.waterLevel;
        this.playerSeedChoice = previousState.playerSeedChoice;
        this.gridState = new Uint8Array(previousState.gridState); //Convert back to Uint8Array
      }

      //Update UI and grid
      this.updateUI();
      this.cellGroup.getChildren().forEach((cell: { row: any; col: any; updateSprite: (arg0: any, arg1: any) => void; }) => {
        const row = cell.row;
        const col = cell.col;

        const plantType = this.getPlantType(row, col);
        const growthLevel = this.getGrowthLevel(row, col);

        cell.updateSprite(plantType, growthLevel);
      });
    } else {
      alert("No more actions to undo!");
    }
  }

  redo() {
    if (this.redoStack.length === 0) {
      alert("No actions to redo!");
      return;
    }

    const nextState = this.redoStack.pop();
    const currentState = {
      day: this.day,
      sunLevel: this.sunLevel,
      waterLevel: this.waterLevel,
      playerSeedChoice: this.playerSeedChoice,
      gridState: Array.from(this.gridState),
    };

    this.undoStack.push(currentState); //Save current state to undo stack
    this.restoreState(nextState);
  }

  restoreState(state: { day: number; sunLevel: number; waterLevel: number; playerSeedChoice: string; gridState: Iterable<number>; } | undefined) {
    this.day = state.day;
    this.sunLevel = state.sunLevel;
    this.waterLevel = state.waterLevel;
    this.playerSeedChoice = state.playerSeedChoice;
    this.gridState = new Uint8Array(state.gridState); //Restore grid state

    this.updateUI();
    this.cellGroup.getChildren().forEach((cell: { row: any; col: any; updateSprite: (arg0: any, arg1: any) => void; }) => {
      const row = cell.row;
      const col = cell.col;

      const plantType = this.getPlantType(row, col);
      const growthLevel = this.getGrowthLevel(row, col);

      cell.updateSprite(plantType, growthLevel);
    });

    console.log("State restored successfully.");
  }

  pushUndoState() {
    const currentState = {
      day: this.day,
      sunLevel: this.sunLevel,
      waterLevel: this.waterLevel,
      playerSeedChoice: this.playerSeedChoice,
      gridState: Array.from(this.gridState), //Convert to JSON-compatible format
    };

    //Avoid pushing duplicate states
    if (
      this.undoStack.length === 0 ||
      JSON.stringify(this.undoStack[this.undoStack.length - 1]) !==
        JSON.stringify(currentState)
    ) {
      this.undoStack.push(currentState);
    }

    //Limit the size of the undo stack (optional)
    if (this.undoStack.length > 50) {
      this.undoStack.shift(); //Remove the oldest state to prevent memory issues
    }
  }
}

export default PlayScene;