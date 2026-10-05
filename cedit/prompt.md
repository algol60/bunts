Use bun, TypeScript, and @opentui/core (https://opentui.com/docs/) to create a terminal-based editor for the file described below.

The file @sample.json contains an example of the file format. The entries in the
"marks" list are to be edited. if there are other keys/values in the JSON file, they must remain unchanged in the edited file.

 Each entry consists of

- "type" either "this" or "that"
- "label" an arbitrary string
- "data" if type is "this", a 4 character string consisting of upper case ASCII letters and digits; if type is "that", a non-empty list of strings of the form "WORDA:WORDB", where each word consists of upper case ASCII letters, ".", or "_".

The editor must be able to:
- add a new entry of type "this" or "that"
- delete an entry
- rename the label in an entry
- if "type" is "this", edit the data string
- if "type" is "that", edit the list; add, delete, edit individual list elements

If data is incorrect, highlight the error.

The user interface finishes editing on Esc. If the document has unsaved changes, a "Save Y/N" dialog box appears; only Y saves the file. N (or Esc again) exits without saving.

The user supplies the path of the file to edit. If not supplied, the default path is "$HOME/cedit.json". If the file does not exist, default to an empty "marks" list.
