-- Loads the extension's modules from files, for the standalone runner and the checks. The packaged extension uses the
-- same convention with its modules bundled into one file (see aseprite/build.mjs), so neither needs `require` or `io`.
--
-- A module is a chunk under aseprite/extension/ that receives `use` as its first argument and returns its table:
--   local use = ...
--   local craft = use("fluid/craft")
--
--   local use = dofile("aseprite/tools/loader.lua")("aseprite/extension", { presets = "aseprite/dist/presets.lua" })
return function(base, extra)
  local cache, files = {}, extra or {}
  local function use(name)
    local m = cache[name]
    if m == nil then
      local path = files[name] or (base .. "/" .. name .. ".lua")
      local chunk = assert(loadfile(path))
      m = chunk(use)
      if m == nil then m = true end
      cache[name] = m
    end
    return m
  end
  return use
end
