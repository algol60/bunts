export type MarkThis = {
  type: 'this'
  label: string
  data: string // 4 chars, A-Z0-9
}

export type MarkThat = {
  type: 'that'
  label: string
  data: string[] // each "WORDA:WORDB", chars A-Z . _
}

export type Mark = MarkThis | MarkThat

export type MarksFile = {
  version: number
  marks: Mark[]
}
