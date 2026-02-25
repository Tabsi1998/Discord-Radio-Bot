// ============================================================================
// command-permissions-store.js – MongoDB-basiert (migriert von JSON-Datei)
// ============================================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";
import {
  COMMAND_PERMISSION_COMMANDS,
  normalizePermissionCommandName,
  isPermissionManagedCommand,
} from "./config/command-permissions.js";

const COLLECTION = "command_permissions";

function col() {
  const db = getDb();
  return db ? db.collection(COLLECTION) : null;
}

function getSupportedPermissionCommands() {
  return [...COMMAND_PERMISSION_COMMANDS];
}

async function getGuildCommandPermissionRules(guildId) {
  const c = col();
  if (!c) return {};
  try {
    const docs = await c
      .find({ guildId: String(guildId) }, { projection: { _id: 0, guildId: 0, updatedAt: 0 } })
      .toArray();
    const rules = {};
    for (const doc of docs) {
      rules[doc.commandName] = {
        allowRoleIds: doc.allowRoleIds || [],
        denyRoleIds: doc.denyRoleIds || [],
      };
    }
    return rules;
  } catch (err) {
    log("ERROR", `getGuildCommandPermissionRules fehlgeschlagen: ${err.message}`);
    return {};
  }
}

async function getCommandPermissionRule(guildId, commandName) {
  const c = col();
  const name = normalizePermissionCommandName(commandName);
  if (!c || !name) return null;
  try {
    const doc = await c.findOne(
      { guildId: String(guildId), commandName: name },
      { projection: { _id: 0, guildId: 0, updatedAt: 0 } }
    );
    if (!doc) return null;
    return {
      allowRoleIds: doc.allowRoleIds || [],
      denyRoleIds: doc.denyRoleIds || [],
    };
  } catch (err) {
    log("ERROR", `getCommandPermissionRule fehlgeschlagen: ${err.message}`);
    return null;
  }
}

async function setCommandRolePermission(guildId, commandName, roleId, action) {
  const c = col();
  const name = normalizePermissionCommandName(commandName);
  if (!c || !name) return false;
  const gid = String(guildId);
  const rid = String(roleId);

  try {
    const doc = await c.findOne({ guildId: gid, commandName: name });
    let allowRoleIds = doc?.allowRoleIds || [];
    let denyRoleIds = doc?.denyRoleIds || [];

    if (action === "allow") {
      denyRoleIds = denyRoleIds.filter((id) => id !== rid);
      if (!allowRoleIds.includes(rid)) allowRoleIds.push(rid);
    } else if (action === "deny") {
      allowRoleIds = allowRoleIds.filter((id) => id !== rid);
      if (!denyRoleIds.includes(rid)) denyRoleIds.push(rid);
    } else {
      return false;
    }

    await c.updateOne(
      { guildId: gid, commandName: name },
      { $set: { guildId: gid, commandName: name, allowRoleIds, denyRoleIds, updatedAt: new Date() } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    log("ERROR", `setCommandRolePermission fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function removeCommandRolePermission(guildId, commandName, roleId) {
  const c = col();
  const name = normalizePermissionCommandName(commandName);
  if (!c || !name) return false;
  const gid = String(guildId);
  const rid = String(roleId);

  try {
    await c.updateOne(
      { guildId: gid, commandName: name },
      { $pull: { allowRoleIds: rid, denyRoleIds: rid }, $set: { updatedAt: new Date() } }
    );
    return true;
  } catch (err) {
    log("ERROR", `removeCommandRolePermission fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function resetCommandPermissions(guildId, commandName) {
  const c = col();
  if (!c) return false;
  const gid = String(guildId);

  try {
    if (commandName) {
      const name = normalizePermissionCommandName(commandName);
      if (name) {
        await c.deleteOne({ guildId: gid, commandName: name });
      }
    } else {
      await c.deleteMany({ guildId: gid });
    }
    return true;
  } catch (err) {
    log("ERROR", `resetCommandPermissions fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function evaluateCommandPermission(guildId, commandName, memberRoleIds = []) {
  const name = normalizePermissionCommandName(commandName);
  if (!name || !isPermissionManagedCommand(name)) {
    return { allowed: true, reason: "unmanaged" };
  }

  const rule = await getCommandPermissionRule(guildId, name);
  if (!rule) return { allowed: true, reason: "no_rule" };

  const { allowRoleIds = [], denyRoleIds = [] } = rule;

  // Deny takes precedence
  for (const rid of memberRoleIds) {
    if (denyRoleIds.includes(rid)) {
      return { allowed: false, reason: "denied", roleId: rid };
    }
  }

  // If there are explicit allow rules, member must have one
  if (allowRoleIds.length > 0) {
    for (const rid of memberRoleIds) {
      if (allowRoleIds.includes(rid)) {
        return { allowed: true, reason: "allowed", roleId: rid };
      }
    }
    return { allowed: false, reason: "not_in_allow_list" };
  }

  return { allowed: true, reason: "default" };
}

// Legacy compat
const getCommandPermission = getCommandPermissionRule;
const setCommandPermission = setCommandRolePermission;
const removeCommandPermission = removeCommandRolePermission;
const listCommandPermissions = getGuildCommandPermissionRules;

export {
  getSupportedPermissionCommands,
  getGuildCommandPermissionRules,
  getCommandPermissionRule,
  setCommandRolePermission,
  removeCommandRolePermission,
  resetCommandPermissions,
  evaluateCommandPermission,
  getCommandPermission,
  setCommandPermission,
  removeCommandPermission,
  listCommandPermissions,
};
