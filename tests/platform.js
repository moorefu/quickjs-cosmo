import * as os from "os";
import { equal, finish } from "./assert.js";

equal(os.platform, scriptArgs[1], "os.platform must reflect the runtime host");
finish("platform");
