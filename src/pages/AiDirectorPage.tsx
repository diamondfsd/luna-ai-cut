import { DirectorLabView } from '../components/DirectorLabView'

interface AiDirectorPageProps {
  pageActive: boolean
}

export function AiDirectorPage({ pageActive }: AiDirectorPageProps) {
  return <DirectorLabView active={pageActive} />
}
