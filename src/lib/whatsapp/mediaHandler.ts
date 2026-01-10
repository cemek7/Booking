import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createEvolutionClient, getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';

export interface MediaFile {
  id: string;
  tenant_id: string;
  phone_number: string;
  message_id: string;
  file_type: 'image' | 'document' | 'audio' | 'video' | 'sticker';
  mime_type: string;
  file_name: string;
  file_size: number;
  file_url: string;
  thumbnail_url?: string;
  caption?: string;
  duration?: number; // For audio/video
  metadata: Record<string, any>;
  processed: boolean;
  created_at: string;
}

export interface MediaProcessingResult {
  success: boolean;
  mediaId?: string;
  url?: string;
  thumbnailUrl?: string;
  error?: string;
  metadata?: Record<string, any>;
}

class WhatsAppMediaHandler {
  private supabase = createServerSupabaseClient();
  private readonly MAX_FILE_SIZE = 64 * 1024 * 1024; // 64MB
  private readonly SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  private readonly SUPPORTED_DOCUMENT_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ];
  private readonly SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac'];
  private readonly SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/3gpp', 'video/quicktime'];

  /**
   * Process incoming media message from WhatsApp
   */
  async processIncomingMedia(
    tenantId: string,
    phoneNumber: string,
    message: any
  ): Promise<MediaProcessingResult> {
    try {
      console.log(`Processing incoming media from ${phoneNumber}:`, message.type);

      // Get WhatsApp configuration
      const whatsappConfig = await getTenantWhatsAppConfig(tenantId);
      if (!whatsappConfig) {
        throw new Error('No WhatsApp configuration found for tenant');
      }

      const evolutionClient = createEvolutionClient(whatsappConfig);

      // Download media from WhatsApp
      const mediaData = await this.downloadMediaFromWhatsApp(
        evolutionClient,
        message
      );

      if (!mediaData.success) {
        return {
          success: false,
          error: `Failed to download media: ${mediaData.error}`
        };
      }

      // Validate media
      const validation = this.validateMedia(message.type, mediaData.mimeType, mediaData.size);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }

      // Upload to Supabase Storage
      const uploadResult = await this.uploadToStorage(
        tenantId,
        mediaData.buffer,
        mediaData.fileName,
        mediaData.mimeType
      );

      if (!uploadResult.success) {
        return {
          success: false,
          error: `Upload failed: ${uploadResult.error}`
        };
      }

      // Generate thumbnail if needed
      let thumbnailUrl;
      if (message.type === 'image' || message.type === 'video') {
        const thumbnailResult = await this.generateThumbnail(
          mediaData.buffer,
          message.type,
          tenantId
        );
        if (thumbnailResult.success) {
          thumbnailUrl = thumbnailResult.url;
        }
      }

      // Extract metadata
      const metadata = await this.extractMetadata(
        mediaData.buffer,
        message.type,
        mediaData.mimeType
      );

      // Store media record in database
      const mediaRecord: Omit<MediaFile, 'id' | 'created_at'> = {
        tenant_id: tenantId,
        phone_number: phoneNumber,
        message_id: message.id,
        file_type: message.type,
        mime_type: mediaData.mimeType,
        file_name: mediaData.fileName,
        file_size: mediaData.size,
        file_url: uploadResult.url!,
        thumbnail_url: thumbnailUrl,
        caption: message.caption,
        duration: metadata.duration,
        metadata: {
          ...metadata,
          original_url: mediaData.originalUrl
        },
        processed: true
      };

      const { data: savedMedia, error: saveError } = await this.supabase
        .from('whatsapp_media')
        .insert(mediaRecord)
        .select()
        .single();

      if (saveError) {
        console.error('Failed to save media record:', saveError);
        // Don't fail the entire operation for database issues
      }

      console.log(`Successfully processed ${message.type} media for ${phoneNumber}`);

      return {
        success: true,
        mediaId: savedMedia?.id,
        url: uploadResult.url,
        thumbnailUrl,
        metadata: {
          ...metadata,
          fileType: message.type,
          fileName: mediaData.fileName,
          fileSize: mediaData.size
        }
      };

    } catch (error) {
      console.error('Error processing incoming media:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send media message via WhatsApp
   */
  async sendMedia(
    tenantId: string,
    phoneNumber: string,
    mediaFile: File | Buffer,
    type: MediaFile['file_type'],
    options: {
      caption?: string;
      fileName?: string;
      mimeType?: string;
    } = {}
  ): Promise<MediaProcessingResult> {
    try {
      console.log(`Sending ${type} media to ${phoneNumber}`);

      // Get WhatsApp configuration
      const whatsappConfig = await getTenantWhatsAppConfig(tenantId);
      if (!whatsappConfig) {
        throw new Error('No WhatsApp configuration found for tenant');
      }

      const evolutionClient = createEvolutionClient(whatsappConfig);

      // Convert File to Buffer if needed
      let buffer: Buffer;
      let fileName: string;
      let mimeType: string;

      if (mediaFile instanceof File) {
        buffer = Buffer.from(await mediaFile.arrayBuffer());
        fileName = options.fileName || mediaFile.name;
        mimeType = options.mimeType || mediaFile.type;
      } else {
        buffer = mediaFile;
        fileName = options.fileName || `media_${Date.now()}`;
        mimeType = options.mimeType || 'application/octet-stream';
      }

      // Validate media
      const validation = this.validateMedia(type, mimeType, buffer.length);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }

      // Upload to temporary storage first
      const uploadResult = await this.uploadToStorage(
        tenantId,
        buffer,
        fileName,
        mimeType
      );

      if (!uploadResult.success) {
        return {
          success: false,
          error: `Upload failed: ${uploadResult.error}`
        };
      }

      // Send via WhatsApp Evolution
      let sendResult;
      switch (type) {
        case 'image':
          sendResult = await evolutionClient.sendImageMessage(
            phoneNumber,
            uploadResult.url!,
            options.caption
          );
          break;
        case 'document':
          sendResult = await evolutionClient.sendDocumentMessage(
            phoneNumber,
            uploadResult.url!,
            fileName,
            options.caption
          );
          break;
        case 'audio':
          sendResult = await evolutionClient.sendAudioMessage(
            phoneNumber,
            uploadResult.url!
          );
          break;
        case 'video':
          sendResult = await evolutionClient.sendVideoMessage(
            phoneNumber,
            uploadResult.url!,
            options.caption
          );
          break;
        default:
          throw new Error(`Unsupported media type: ${type}`);
      }

      if (!sendResult.success) {
        return {
          success: false,
          error: `Failed to send media: ${sendResult.error}`
        };
      }

      // Store sent media record
      const mediaRecord: Omit<MediaFile, 'id' | 'created_at'> = {
        tenant_id: tenantId,
        phone_number: phoneNumber,
        message_id: sendResult.messageId || `out-${Date.now()}`,
        file_type: type,
        mime_type: mimeType,
        file_name: fileName,
        file_size: buffer.length,
        file_url: uploadResult.url!,
        caption: options.caption,
        metadata: {
          sent: true,
          messageId: sendResult.messageId
        },
        processed: true
      };

      await this.supabase
        .from('whatsapp_media')
        .insert(mediaRecord);

      return {
        success: true,
        mediaId: sendResult.messageId,
        url: uploadResult.url,
        metadata: {
          messageId: sendResult.messageId,
          fileType: type,
          fileName,
          fileSize: buffer.length
        }
      };

    } catch (error) {
      console.error('Error sending media:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Download media from WhatsApp
   */
  private async downloadMediaFromWhatsApp(
    evolutionClient: any,
    message: any
  ): Promise<{
    success: boolean;
    buffer?: Buffer;
    mimeType?: string;
    fileName?: string;
    size?: number;
    originalUrl?: string;
    error?: string;
  }> {
    try {
      // This would use the Evolution API to download media
      // For now, simulating the process
      const mediaUrl = message.mediaUrl || message.url;
      if (!mediaUrl) {
        return { success: false, error: 'No media URL provided' };
      }

      // Download from WhatsApp servers via Evolution API
      const response = await fetch(mediaUrl);
      if (!response.ok) {
        return { success: false, error: `Failed to download: ${response.status}` };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType = message.mimeType || response.headers.get('content-type') || 'application/octet-stream';
      
      // Generate filename if not provided
      const extension = this.getFileExtension(mimeType);
      const fileName = message.filename || 
        message.caption?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50) || 
        `media_${Date.now()}${extension}`;

      return {
        success: true,
        buffer,
        mimeType,
        fileName,
        size: buffer.length,
        originalUrl: mediaUrl
      };

    } catch (error) {
      console.error('Error downloading media from WhatsApp:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Download failed'
      };
    }
  }

  /**
   * Upload media to Supabase Storage
   */
  private async uploadToStorage(
    tenantId: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const bucket = 'whatsapp-media';
      const filePath = `${tenantId}/${Date.now()}_${fileName}`;

      const { data, error } = await this.supabase.storage
        .from(bucket)
        .upload(filePath, buffer, {
          contentType: mimeType,
          cacheControl: '3600'
        });

      if (error) {
        console.error('Storage upload error:', error);
        return { success: false, error: error.message };
      }

      // Get public URL
      const { data: publicUrlData } = this.supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      return {
        success: true,
        url: publicUrlData.publicUrl
      };

    } catch (error) {
      console.error('Error uploading to storage:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed'
      };
    }
  }

  /**
   * Generate thumbnail for images and videos
   */
  private async generateThumbnail(
    buffer: Buffer,
    mediaType: string,
    tenantId: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      // For now, return the original image as thumbnail for images
      // In production, you'd want to use Sharp or similar to resize
      if (mediaType === 'image') {
        const thumbnailPath = `${tenantId}/thumbnails/${Date.now()}_thumb.jpg`;
        
        const { data, error } = await this.supabase.storage
          .from('whatsapp-media')
          .upload(thumbnailPath, buffer, {
            contentType: 'image/jpeg',
            cacheControl: '3600'
          });

        if (error) {
          return { success: false, error: error.message };
        }

        const { data: publicUrlData } = this.supabase.storage
          .from('whatsapp-media')
          .getPublicUrl(data.path);

        return {
          success: true,
          url: publicUrlData.publicUrl
        };
      }

      // For videos, we'd extract a frame
      // This would require ffmpeg or similar
      return { success: false, error: 'Video thumbnail generation not implemented' };

    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Thumbnail generation failed'
      };
    }
  }

  /**
   * Extract metadata from media files
   */
  private async extractMetadata(
    buffer: Buffer,
    mediaType: string,
    mimeType: string
  ): Promise<Record<string, any>> {
    try {
      const metadata: Record<string, any> = {
        size: buffer.length,
        mimeType,
        processedAt: new Date().toISOString()
      };

      // For images, we could extract EXIF data
      if (mediaType === 'image') {
        // This would require exifr or similar library
        metadata.type = 'image';
      }

      // For audio/video, extract duration
      if (mediaType === 'audio' || mediaType === 'video') {
        // This would require ffprobe or similar
        metadata.type = mediaType;
      }

      // For documents, extract basic info
      if (mediaType === 'document') {
        metadata.type = 'document';
        metadata.extension = this.getFileExtension(mimeType);
      }

      return metadata;

    } catch (error) {
      console.error('Error extracting metadata:', error);
      return {
        error: 'Failed to extract metadata',
        processedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Validate media file
   */
  private validateMedia(
    type: string,
    mimeType: string,
    size: number
  ): { valid: boolean; error?: string } {
    // Check file size
    if (size > this.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File too large. Maximum size is ${this.MAX_FILE_SIZE / 1024 / 1024}MB`
      };
    }

    // Check mime type based on media type
    let supportedTypes: string[];
    switch (type) {
      case 'image':
        supportedTypes = this.SUPPORTED_IMAGE_TYPES;
        break;
      case 'document':
        supportedTypes = this.SUPPORTED_DOCUMENT_TYPES;
        break;
      case 'audio':
        supportedTypes = this.SUPPORTED_AUDIO_TYPES;
        break;
      case 'video':
        supportedTypes = this.SUPPORTED_VIDEO_TYPES;
        break;
      default:
        return { valid: false, error: `Unsupported media type: ${type}` };
    }

    if (!supportedTypes.includes(mimeType)) {
      return {
        valid: false,
        error: `Unsupported file format: ${mimeType}`
      };
    }

    return { valid: true };
  }

  /**
   * Get file extension from mime type
   */
  private getFileExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'audio/mpeg': '.mp3',
      'audio/ogg': '.ogg',
      'audio/wav': '.wav',
      'audio/aac': '.aac',
      'video/mp4': '.mp4',
      'video/3gpp': '.3gp',
      'video/quicktime': '.mov'
    };

    return extensions[mimeType] || '';
  }

  /**
   * Get media file by ID
   */
  async getMediaFile(mediaId: string): Promise<MediaFile | null> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_media')
        .select('*')
        .eq('id', mediaId)
        .single();

      if (error) {
        console.error('Failed to get media file:', error);
        return null;
      }

      return data as MediaFile;
    } catch (error) {
      console.error('Error getting media file:', error);
      return null;
    }
  }

  /**
   * Delete media file
   */
  async deleteMediaFile(mediaId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const mediaFile = await this.getMediaFile(mediaId);
      if (!mediaFile) {
        return { success: false, error: 'Media file not found' };
      }

      // Delete from storage
      const urlPath = new URL(mediaFile.file_url).pathname;
      const filePath = urlPath.replace('/storage/v1/object/public/whatsapp-media/', '');

      await this.supabase.storage
        .from('whatsapp-media')
        .remove([filePath]);

      // Delete thumbnail if exists
      if (mediaFile.thumbnail_url) {
        const thumbnailPath = new URL(mediaFile.thumbnail_url).pathname;
        const thumbnailFilePath = thumbnailPath.replace('/storage/v1/object/public/whatsapp-media/', '');
        
        await this.supabase.storage
          .from('whatsapp-media')
          .remove([thumbnailFilePath]);
      }

      // Delete database record
      const { error } = await this.supabase
        .from('whatsapp_media')
        .delete()
        .eq('id', mediaId);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };

    } catch (error) {
      console.error('Error deleting media file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Delete failed'
      };
    }
  }
}

// Export singleton instance
export const whatsappMediaHandler = new WhatsAppMediaHandler();