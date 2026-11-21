# Owns exactly two importers and one menu entry; enabling never saves project settings.
@tool
extends EditorPlugin

const Settings = preload("settings.gd")
const FramesImporter = preload("sprite_frames.gd")
const TilesImporter = preload("tile_set.gd")
const MENU := "Pixelbolt: Reimport all recipes"
var frames_importer: EditorImportPlugin
var tiles_importer: EditorImportPlugin

func _enter_tree() -> void:
	Settings.register()
	frames_importer = FramesImporter.new()
	tiles_importer = TilesImporter.new()
	add_import_plugin(frames_importer)
	add_import_plugin(tiles_importer)
	add_tool_menu_item(MENU, _reimport_all)

func _exit_tree() -> void:
	remove_tool_menu_item(MENU)
	remove_import_plugin(tiles_importer)
	remove_import_plugin(frames_importer)
	tiles_importer = null
	frames_importer = null

func _collect(folder: EditorFileSystemDirectory, files: PackedStringArray) -> void:
	var info := Engine.get_version_info()
	var multipart: bool = int(info["major"]) > 4 or int(info["minor"]) >= 5
	for i in folder.get_file_count():
		var file := folder.get_file_path(i)
		var lower := file.to_lower()
		if lower.ends_with(".pixelbolt") or (multipart and lower.ends_with(".pixel.json")):
			files.append(file)
	for i in folder.get_subdir_count():
		_collect(folder.get_subdir(i), files)

func _reimport_all() -> void:
	var files := PackedStringArray()
	var filesystem := get_editor_interface().get_resource_filesystem()
	_collect(filesystem.get_filesystem(), files)
	if not files.is_empty():
		filesystem.reimport_files(files)
