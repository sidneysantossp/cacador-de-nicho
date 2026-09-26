import type {
  PublicationPackage, YouTubeConnection, YouTubePublishPayload
} from '@/lib/types';

export function youtubePublishReadinessIssues(
  pkg:PublicationPackage|null,
  connection:YouTubeConnection|null
){
  const issues:string[]=[];
  if(!pkg)issues.push('package-missing');
  else{
    if(pkg.status!=='approved')issues.push('package-not-approved');
    if(!pkg.renderOutputPath)issues.push('render-output-missing');
    if(!pkg.thumbnail.storagePath)issues.push('thumbnail-missing');
    if(pkg.metadata.audience==='unset')issues.push('audience-unconfirmed');
    if(pkg.metadata.syntheticMediaDisclosure==='review')issues.push('synthetic-disclosure-unconfirmed');
    if(!pkg.metadata.title.trim())issues.push('title-missing');
    if(!pkg.metadata.categoryId.trim())issues.push('category-missing');
  }
  if(!connection)issues.push('youtube-not-connected');
  else if(connection.status!=='connected')issues.push('youtube-reauth-required');
  else if(pkg&&connection.channelId!==pkg.channelId)issues.push('youtube-channel-mismatch');
  return [...new Set(issues)];
}

export function buildYouTubePublishPayload(
  pkg:PublicationPackage,
  connection:YouTubeConnection
):YouTubePublishPayload{
  const issues=youtubePublishReadinessIssues(pkg,connection);
  if(issues.length)throw new Error('youtube-publish-not-ready:'+issues.join(','));

  return {
    kind:'youtube-publish-job',
    channelId:pkg.channelId,
    packageId:pkg.id,
    packageVersion:pkg.version,
    connectionId:connection.id,
    youtubeChannelId:connection.youtubeChannelId,
    renderOutputPath:pkg.renderOutputPath,
    renderOutputBytes:pkg.renderOutputBytes,
    thumbnailStoragePath:pkg.thumbnail.storagePath!,
    video:{
      title:pkg.metadata.title.trim(),
      description:pkg.metadata.description,
      tags:[...pkg.metadata.tags],
      categoryId:pkg.metadata.categoryId,
      defaultLanguage:pkg.metadata.language,
      privacyStatus:pkg.metadata.visibility,
      license:pkg.metadata.license,
      selfDeclaredMadeForKids:pkg.metadata.audience==='made-for-kids',
      containsSyntheticMedia:pkg.metadata.syntheticMediaDisclosure==='yes'
    },
    requestedBy:'operator',
    createdAt:new Date().toISOString()
  };
}

export function youtubeWatchUrl(videoId:string){
  return 'https://www.youtube.com/watch?v='+encodeURIComponent(videoId);
}
