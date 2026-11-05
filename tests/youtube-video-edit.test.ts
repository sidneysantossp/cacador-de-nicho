import test from 'node:test';
import assert from 'node:assert/strict';
import {
 validateVideoEditPatch,makeVideoEditPreview,verifyVideoEditPreview,editedVideoState
} from '../src/lib/youtube-video-edit-policy';
const id='IQTbwGiTQpA',channelId='UCRBCnTUJ_ow5dXxENuNkdHA',secret='z'.repeat(40),now=1793664000000;
const original={
 title:'Starlink no Brasil',description:'Descrição original',tags:['Starlink','Brasil'],
 categoryId:'28',defaultLanguage:'pt-BR'
};
test('creates a reversible metadata preview preserving untouched fields',()=>{
 const preview=makeVideoEditPreview(id,channelId,original,{title:'Novo título'},secret,now);
 assert.equal(preview.after.title,'Novo título');
 assert.equal(preview.after.description,original.description);
 assert.deepEqual(preview.after.tags,original.tags);
 assert.equal(preview.after.categoryId,'28');
 assert.equal(preview.after.defaultLanguage,'pt-BR');
 assert.deepEqual(verifyVideoEditPreview(preview.confirmationToken,id,channelId,original,secret,now+200),preview.after);
});
test('disallows changing privacy, publishing, category or video file',()=>{
 for(const patch of [{privacyStatus:'public'},{categoryId:'22'},{status:{privacyStatus:'private'}},{videoFile:'x.mp4'},{publishAt:'tomorrow'}]){
  assert.throws(()=>validateVideoEditPatch(patch),/UNSUPPORTED_EDIT_FIELDS/);
 }
});
test('prevents use of preview against a different channel, video, expiry or modified data',()=>{
 const p=makeVideoEditPreview(id,channelId,original,{description:'Nova descrição'},secret,now);
 assert.throws(()=>verifyVideoEditPreview(p.confirmationToken,id,'UCOther1234567890123456',original,secret,now),/WRONG_VIDEO/);
 assert.throws(()=>verifyVideoEditPreview(p.confirmationToken,'anotherId11',channelId,original,secret,now),/WRONG_VIDEO/);
 assert.throws(()=>verifyVideoEditPreview(p.confirmationToken,id,channelId,original,secret,now+600001),/EXPIRED/);
 assert.throws(()=>verifyVideoEditPreview(p.confirmationToken,id,channelId,{...original,title:'editado em outro lugar'},secret,now+1000),/VIDEO_CHANGED/);
});
test('prevents tampered signatures and no-op requests',()=>{
 const p=makeVideoEditPreview(id,channelId,original,{tags:['novo']},secret,now);
 assert.throws(()=>verifyVideoEditPreview(p.confirmationToken.replace(/.$/,'A'),id,channelId,original,secret,now),/INVALID_PREVIEW/);
 assert.throws(()=>makeVideoEditPreview(id,channelId,original,{title:original.title},secret,now),/NO_CHANGES/);
});
test('strict length and markup checks',()=>{
 assert.throws(()=>validateVideoEditPatch({title:'x'.repeat(101)}),/INVALID_TITLE/);
 assert.throws(()=>validateVideoEditPatch({description:'a'.repeat(5001)}),/INVALID_DESCRIPTION/);
 assert.throws(()=>validateVideoEditPatch({title:'<script>alert</script>'}),/INVALID_TITLE/);
 assert.throws(()=>validateVideoEditPatch({tags:['a'.repeat(501)]}),/INVALID_TAGS/);
 const longParagraph=validateVideoEditPatch({description:'Primeira linha\nSegunda linha'});
 assert.equal(longParagraph.description,'Primeira linha\nSegunda linha');
 const next=editedVideoState(original,{description:''});
 assert.equal(next.description,'');
});
